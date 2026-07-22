(function () {
    'use strict';

    var COMPLETED_STATUSES = {
        Labeled: true,
        Historical: true,
        Incomplete: true
    };
    var PROGRESS_SCOPE_KEY = 'labelingProgressScope';
    var FLOATING_CONTROLS_KEY = 'labelingFloatingControls';
    var currentScope = 'page';
    var pageProgress = { handled: 0, uncertain: 0, total: 0 };

    function getRows() {
        return Array.from(document.querySelectorAll('#samplesTableBody tr[data-sample-id]'));
    }

    function valueOf(row, name) {
        var input = row.querySelector('input[name="' + name + '"]');
        return input ? (input.value || '').trim() : '';
    }

    function isRowModified(row) {
        var sampleId = row.dataset.sampleId;
        for (var attrNum = 1; attrNum <= 5; attrNum += 1) {
            if (valueOf(row, 'attr' + attrNum + '_' + sampleId) !== valueOf(row, 'orig_attr' + attrNum + '_' + sampleId)) {
                return true;
            }
        }
        return false;
    }

    function isUncertain(row) {
        var input = row.querySelector('.uncertain-state');
        return !!input && input.value === '1';
    }

    function isRowPending(row) {
        var originalStatus = row.dataset.status || '';
        var uncertaintyChanged = isUncertain(row) !== (originalStatus === 'Uncertain');
        return isRowModified(row) || uncertaintyChanged || !!row.querySelector('.prelabel-accept:checked');
    }

    function refreshRow(row) {
        if (!row) return;

        var originalStatus = row.dataset.status || '';
        var uncertain = isUncertain(row);
        var uncertaintyChanged = uncertain !== (originalStatus === 'Uncertain');
        var accepted = !!row.querySelector('.prelabel-accept:checked');
        var handled = !uncertain && (
            isRowModified(row) ||
            row.dataset.clipboardPasteHandled === '1' ||
            accepted ||
            uncertaintyChanged ||
            !!COMPLETED_STATUSES[originalStatus]
        );

        row.classList.toggle('row-uncertain', uncertain);
        row.classList.toggle('row-handled', handled);
    }

    function numberFromDataset(dock, name) {
        var value = Number(dock.dataset[name]);
        return Number.isFinite(value) ? value : 0;
    }

    function getScopeProgress(scope) {
        var dock = document.getElementById('labelingProgressDock');
        if (!dock || scope === 'page') return pageProgress;

        var prefix = scope === 'overall' ? 'overall' : 'task';
        return {
            handled: numberFromDataset(dock, prefix + 'Handled'),
            uncertain: numberFromDataset(dock, prefix + 'Uncertain'),
            total: numberFromDataset(dock, prefix + 'Total')
        };
    }

    function renderProgressDock() {
        var dock = document.getElementById('labelingProgressDock');
        if (!dock) return;

        var progress = getScopeProgress(currentScope);
        var isOverall = currentScope === 'overall';
        var processed = progress.handled + (isOverall ? 0 : progress.uncertain);
        var remaining = Math.max(0, progress.total - processed);
        var handledPct = progress.total ? progress.handled / progress.total * 100 : 0;
        var uncertainPct = progress.total ? progress.uncertain / progress.total * 100 : 0;
        var processedPct = progress.total ? processed / progress.total * 100 : 0;
        var values = {
            progressDockPercent: Math.round(processedPct) + '%',
            progressDockFraction: processed + ' / ' + progress.total,
            progressDockHandled: progress.handled,
            progressDockUncertain: progress.uncertain,
            progressDockRemaining: remaining
        };

        Object.keys(values).forEach(function (id) {
            var element = document.getElementById(id);
            if (element) element.textContent = String(values[id]);
        });

        var handledBar = document.getElementById('progressDockHandledBar');
        var uncertainBar = document.getElementById('progressDockUncertainBar');
        if (handledBar) {
            handledBar.style.width = isOverall ? '0%' : handledPct.toFixed(1) + '%';
            handledBar.classList.toggle('d-none', isOverall);
        }
        if (uncertainBar) {
            uncertainBar.style.width = isOverall ? '0%' : uncertainPct.toFixed(1) + '%';
            uncertainBar.classList.toggle('d-none', isOverall);
        }

        dock.querySelectorAll('[data-overall-status]').forEach(function (segment) {
            var count = numberFromDataset(dock, 'overall' + segment.dataset.overallStatus.charAt(0).toUpperCase() + segment.dataset.overallStatus.slice(1));
            segment.style.width = isOverall && progress.total ? (count / progress.total * 100).toFixed(1) + '%' : '0%';
            segment.classList.toggle('d-none', !isOverall);
        });

        var workflowMeta = document.getElementById('progressDockWorkflowMeta');
        var statusMeta = document.getElementById('progressDockStatusMeta');
        if (workflowMeta) workflowMeta.classList.toggle('d-none', isOverall);
        if (statusMeta) statusMeta.classList.toggle('d-none', !isOverall);

        dock.querySelectorAll('[data-progress-scope]').forEach(function (button) {
            var active = button.dataset.progressScope === currentScope;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function selectProgressScope(scope) {
        if (['overall', 'task', 'page'].indexOf(scope) === -1) return;
        currentScope = scope;
        try {
            window.localStorage.setItem(PROGRESS_SCOPE_KEY, scope);
        } catch (error) {
            // Storage can be unavailable in private or restricted browser contexts.
        }
        renderProgressDock();
    }

    function setFloatingControls(enabled) {
        var button = document.getElementById('floatingControlsToggle');
        document.body.classList.toggle('labeling-floating-disabled', !enabled);
        if (button) {
            var label = enabled ? button.dataset.unpinLabel : button.dataset.pinLabel;
            button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            button.setAttribute('aria-label', label);
            button.title = label;
        }
        if (window.LabelingClipboard && typeof window.LabelingClipboard.syncSelectionUI === 'function') {
            window.LabelingClipboard.syncSelectionUI();
        }
        try {
            window.localStorage.setItem(FLOATING_CONTROLS_KEY, enabled ? '1' : '0');
        } catch (error) {
            // Keep the preference for the current page when storage is restricted.
        }
    }

    function restoreFloatingControls() {
        var enabled = true;
        try {
            enabled = window.localStorage.getItem(FLOATING_CONTROLS_KEY) !== '0';
        } catch (error) {
            enabled = true;
        }
        setFloatingControls(enabled);
    }

    function refreshPageProgress() {
        var rows = getRows();
        var handled = 0;
        var uncertain = 0;
        var pending = 0;

        rows.forEach(function (row) {
            refreshRow(row);
            if (isRowPending(row)) pending += 1;
            if (row.classList.contains('row-uncertain')) {
                uncertain += 1;
            } else if (row.classList.contains('row-handled')) {
                handled += 1;
            }
        });

        pageProgress = { handled: handled, uncertain: uncertain, total: rows.length };
        var pendingCounter = document.getElementById('prelabelPendingCount');
        if (pendingCounter) {
            var pendingTemplate = pendingCounter.dataset.pendingTemplate || 'Pending save on this page: {count}';
            pendingCounter.textContent = pendingTemplate.replace(/\{count\}/g, String(pending));
            pendingCounter.classList.toggle('d-none', pending === 0);
        }
        renderProgressDock();
    }

    function setUncertainState(row, nextState, acceptedState) {
        var button = row && row.querySelector('.uncertain-toggle');
        if (!row || !button) return false;

        var stateInput = row.querySelector('.uncertain-state');
        if (!stateInput) return false;

        stateInput.value = nextState ? '1' : '0';
        button.setAttribute('aria-pressed', nextState ? 'true' : 'false');

        var label = button.querySelector('span');
        var buttonLabel = nextState ? button.dataset.cancelLabel : button.dataset.markLabel;
        if (label) {
            label.textContent = buttonLabel;
        }
        button.title = buttonLabel;
        button.setAttribute('aria-label', buttonLabel);

        var accept = row.querySelector('.prelabel-accept');
        var reviewApi = window.LabelingPrelabelReview;
        if (accept) {
            var targetAccepted = nextState ? false : !!acceptedState;
            if (reviewApi && typeof reviewApi.setAcceptanceForUncertain === 'function') {
                reviewApi.setAcceptanceForUncertain(row, targetAccepted);
            } else if (accept.checked !== targetAccepted) {
                accept.checked = targetAccepted;
                accept.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        refreshPageProgress();
        return true;
    }

    function toggleUncertain(button) {
        var row = button.closest('tr[data-sample-id]');
        if (!row) return false;

        var stateInput = row.querySelector('.uncertain-state');
        if (!stateInput) return false;

        var accept = row.querySelector('.prelabel-accept');
        var beforeState = stateInput.value === '1';
        var beforeAccepted = !!(accept && accept.checked);
        var nextState = !beforeState;
        if (!setUncertainState(row, nextState, beforeAccepted)) return false;

        var transactionState = {
            sampleId: String(row.dataset.sampleId || ''),
            beforeUncertain: beforeState,
            afterUncertain: nextState,
            beforeAccepted: beforeAccepted,
            afterAccepted: !!(accept && accept.checked)
        };

        var clipboardApi = window.LabelingClipboard;
        if (clipboardApi && typeof clipboardApi.pushPasteTransaction === 'function') {
            clipboardApi.pushPasteTransaction({
                operationType: 'uncertain-toggle',
                createdAt: Date.now(),
                canUndo: function () {
                    var currentState = row.querySelector('.uncertain-state');
                    var currentAccept = row.querySelector('.prelabel-accept');
                    return !!currentState &&
                        (currentState.value === '1') === transactionState.afterUncertain &&
                        !!(currentAccept && currentAccept.checked) === transactionState.afterAccepted;
                },
                applyUndo: function () {
                    var restored = setUncertainState(
                        row,
                        transactionState.beforeUncertain,
                        transactionState.beforeAccepted
                    );
                    var reviewApi = window.LabelingPrelabelReview;
                    if (restored && reviewApi && typeof reviewApi.setActiveRow === 'function') {
                        reviewApi.setActiveRow(row, { scroll: true });
                    }
                    return restored;
                },
                undoMessage: (window.labelingKeyboardI18n || {}).undoUncertainApplied || 'Undid uncertain status change.'
            });
        }

        return transactionState;
    }

    document.addEventListener('input', function (event) {
        if (event.target.classList && event.target.classList.contains('attr-input')) {
            refreshPageProgress();
        }
    });

    document.addEventListener('change', function (event) {
        if (event.target.matches && event.target.matches('.attr-input, .prelabel-accept')) {
            refreshPageProgress();
        }
    });

    document.addEventListener('click', function (event) {
        var floatingButton = event.target.closest && event.target.closest('#floatingControlsToggle');
        if (floatingButton) {
            setFloatingControls(floatingButton.getAttribute('aria-pressed') !== 'true');
            return;
        }

        var scopeButton = event.target.closest && event.target.closest('[data-progress-scope]');
        if (scopeButton) {
            selectProgressScope(scopeButton.dataset.progressScope);
            return;
        }

        var button = event.target.closest && event.target.closest('.uncertain-toggle');
        if (button) toggleUncertain(button);
    });

    var tableBody = document.getElementById('samplesTableBody');
    if (tableBody && window.MutationObserver) {
        new MutationObserver(function (mutations) {
            var changed = mutations.some(function (mutation) {
                return mutation.target.classList && mutation.target.classList.contains('attr-input');
            });
            if (changed) refreshPageProgress();
        }).observe(tableBody, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    window.refreshLabelingRowProgress = refreshPageProgress;
    window.LabelingRowProgress = {
        toggleUncertainForRow: function (row) {
            if (!row || !row.matches('tr[data-sample-id]')) return false;
            var button = row.querySelector('.uncertain-toggle');
            if (!button) return false;
            return toggleUncertain(button);
        },
        restoreUncertainForRow: function (row, uncertain, accepted) {
            if (!row || !row.matches('tr[data-sample-id]')) return false;
            return setUncertainState(row, !!uncertain, !!accepted);
        }
    };
    try {
        currentScope = window.localStorage.getItem(PROGRESS_SCOPE_KEY) || 'page';
    } catch (error) {
        currentScope = 'page';
    }
    if (['overall', 'task', 'page'].indexOf(currentScope) === -1) currentScope = 'page';
    restoreFloatingControls();
    refreshPageProgress();
}());
