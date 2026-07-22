(function () {
    'use strict';

    var activeSampleId = null;
    var prelabelUndoStack = [];
    var MAX_PRELABEL_UNDO = 30;
    var isApplyingPrelabelUndo = false;
    var isCancelingAcceptanceForEdit = false;
    var isApplyingUncertainChange = false;

    function getConfig() {
        return window.prelabelReviewI18n || {};
    }

    function t(key, fallback) {
        var cfg = getConfig();
        return cfg[key] || fallback;
    }

    function format(template, replacements) {
        var message = template;
        Object.keys(replacements).forEach(function (k) {
            message = message.replace(new RegExp('\\{' + k + '\\}', 'g'), String(replacements[k]));
        });
        return message;
    }

    function showNotice(message, type) {
        if (window.LabelingClipboard && typeof window.LabelingClipboard.showClipboardToast === 'function') {
            window.LabelingClipboard.showClipboardToast(message, type || 'info');
            return;
        }
        if (type === 'warning') {
            window.console.warn(message);
        } else {
            window.console.info(message);
        }
    }

    function getRows() {
        return Array.from(document.querySelectorAll('tr[data-sample-id]'));
    }

    function getRowBySampleId(sampleId) {
        return document.querySelector('tr[data-sample-id="' + sampleId + '"]');
    }

    function getAcceptCheckbox(row) {
        return row ? row.querySelector('.prelabel-accept') : null;
    }

    function isPrelabeledRow(row) {
        return !!(row && row.dataset && row.dataset.status === 'Prelabeled' && getAcceptCheckbox(row));
    }

    function isAcceptedRow(row) {
        var checkbox = getAcceptCheckbox(row);
        return !!(checkbox && checkbox.checked);
    }

    function hasModifiedAttributes(row) {
        if (!row || !row.dataset) {
            return false;
        }

        var sampleId = String(row.dataset.sampleId || '');
        if (!sampleId) {
            return false;
        }

        for (var attrNum = 1; attrNum <= 5; attrNum += 1) {
            var currentInput = row.querySelector('input[name="attr' + attrNum + '_' + sampleId + '"]');
            var originalInput = row.querySelector('input[name="orig_attr' + attrNum + '_' + sampleId + '"]');
            var currentValue = currentInput ? (currentInput.value || '').trim() : '';
            var originalValue = originalInput ? (originalInput.value || '').trim() : '';
            if (currentValue !== originalValue) {
                return true;
            }
        }

        return false;
    }

    function cancelAcceptanceForModifiedRow(element) {
        var row = element && element.matches && element.matches('tr[data-sample-id]')
            ? element
            : (element && element.closest ? element.closest('tr[data-sample-id]') : null);
        if (!isPrelabeledRow(row) || !isAcceptedRow(row) || !hasModifiedAttributes(row)) {
            return false;
        }

        var checkbox = getAcceptCheckbox(row);
        isCancelingAcceptanceForEdit = true;
        try {
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            isCancelingAcceptanceForEdit = false;
        }

        showNotice(
            t('acceptanceCanceledAfterEdit', 'Prelabel acceptance was canceled because the attributes were modified.'),
            'warning'
        );
        return true;
    }

    function showModifiedAcceptanceWarning(row) {
        setActiveRow(row);
        showNotice(
            t('modifiedCannotAccept', 'Modified attributes cannot be accepted as prelabeled. Save them as manual edits instead.'),
            'warning'
        );
    }

    function hasOpenModal() {
        return !!document.querySelector('.modal.show');
    }

    function isEditableTarget(element) {
        if (!element) {
            return false;
        }

        if (element.closest('.modal.show')) {
            return true;
        }

        if (element.matches && element.matches('textarea, select, button, [contenteditable="true"]')) {
            return true;
        }

        if (element.isContentEditable) {
            return true;
        }

        if (element.tagName === 'INPUT') {
            var inputType = (element.type || 'text').toLowerCase();
            var nonEditable = {
                checkbox: true,
                radio: true,
                hidden: true
            };
            return !nonEditable[inputType];
        }

        return !!element.closest('textarea, select, button, [contenteditable="true"], .multiselect-container');
    }

    function clearActiveRow() {
        getRows().forEach(function (row) {
            row.classList.remove('labeling-row-active');
        });
        activeSampleId = null;
    }

    function setActiveRow(row, options) {
        var opts = options || {};

        if (!row || !row.dataset || !row.dataset.sampleId) {
            clearActiveRow();
            return;
        }

        getRows().forEach(function (r) {
            if (r === row) {
                r.classList.add('labeling-row-active');
            } else {
                r.classList.remove('labeling-row-active');
            }
        });

        activeSampleId = String(row.dataset.sampleId || '');

        if (opts.scroll) {
            row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function syncRowVisualState(row) {
        if (!isPrelabeledRow(row)) {
            return;
        }

        var accepted = isAcceptedRow(row);
        var pendingText = row.querySelector('.prelabel-pending-text');

        if (accepted) {
            row.classList.add('prelabel-pending-accept');
            if (pendingText) {
                pendingText.classList.remove('d-none');
                pendingText.textContent = t('acceptedPendingSave', 'Accepted, pending save');
            }
        } else {
            row.classList.remove('prelabel-pending-accept');
            if (pendingText) {
                pendingText.classList.add('d-none');
            }
        }

        row.dataset.acceptedState = accepted ? '1' : '0';
    }

    function syncAllRowsAndCount() {
        getRows().forEach(syncRowVisualState);

        if (typeof window.refreshLabelingRowProgress === 'function') {
            window.refreshLabelingRowProgress();
        }
    }

    function getCurrentActiveRow() {
        if (!activeSampleId) {
            return null;
        }
        return getRowBySampleId(activeSampleId);
    }

    function getNextRow(currentRow) {
        var rows = getRows();
        var currentIndex = currentRow ? rows.indexOf(currentRow) : -1;
        return currentIndex >= 0 && currentIndex < rows.length - 1 ? rows[currentIndex + 1] : null;
    }

    function continueWorkflowAtRow(row) {
        if (!row) {
            return false;
        }

        var keyboardApi = window.LabelingKeyboardNavigation;
        if (isPrelabeledRow(row)) {
            if (keyboardApi && typeof keyboardApi.enterReviewRow === 'function') {
                return keyboardApi.enterReviewRow(row);
            }
            setActiveRow(row, { scroll: true });
            var checkbox = row.querySelector('.sample-checkbox');
            if (checkbox) {
                checkbox.focus({ preventScroll: true });
            }
            return true;
        }

        if (keyboardApi && typeof keyboardApi.enterEditRow === 'function') {
            return keyboardApi.enterEditRow(row);
        }

        setActiveRow(row, { scroll: true });
        var firstInput = row.querySelector('.attr-input[data-attr="1"], .attr-input');
        if (firstInput) {
            firstInput.focus();
        }
        return true;
    }

    function continueWorkflowAfterRow(row) {
        var nextRow = getNextRow(row);
        if (nextRow) {
            return continueWorkflowAtRow(nextRow);
        }

        setActiveRow(row);
        showNotice(t('pageReviewDone', 'All prelabeled records on this page reviewed. Please save this page.'));
        return false;
    }

    function setAcceptanceForUncertain(row, checked) {
        var checkbox = getAcceptCheckbox(row);
        if (!checkbox || checkbox.checked === !!checked) {
            return false;
        }

        isApplyingUncertainChange = true;
        try {
            checkbox.checked = !!checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            isApplyingUncertainChange = false;
        }
        return true;
    }

    function acceptRow(row) {
        if (!isPrelabeledRow(row)) {
            return false;
        }

        var checkbox = getAcceptCheckbox(row);
        if (!checkbox || checkbox.checked) {
            return false;
        }

        if (hasModifiedAttributes(row)) {
            showModifiedAcceptanceWarning(row);
            return false;
        }

        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function acceptReviewRow(row) {
        if (!row) {
            return false;
        }

        setActiveRow(row);
        if (!isPrelabeledRow(row)) {
            showNotice(
                t('nonPrelabeledCannotAccept', 'Only prelabeled rows can be accepted.'),
                'warning'
            );
            return false;
        }

        if (isAcceptedRow(row)) {
            return false;
        }

        return acceptRow(row);
    }

    function getAdjacentRow(row, direction) {
        var rows = getRows();
        if (rows.length === 0) {
            return null;
        }

        var currentIndex = rows.indexOf(row);
        if (currentIndex === -1) {
            return direction < 0 ? rows[rows.length - 1] : rows[0];
        }

        var nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + direction));
        return rows[nextIndex];
    }

    function chooseActiveFromSelection() {
        var checked = Array.from(document.querySelectorAll('.sample-checkbox:checked'));

        if (checked.length !== 1) {
            return;
        }

        var row = checked[0].closest('tr[data-sample-id]');
        if (row) {
            setActiveRow(row);
        }
    }

    function pushPrelabelUndoAction(sampleId, beforeAccepted, afterAccepted) {
        prelabelUndoStack.push({
            sampleId: String(sampleId),
            beforeAccepted: !!beforeAccepted,
            afterAccepted: !!afterAccepted,
            createdAt: Date.now()
        });

        if (prelabelUndoStack.length > MAX_PRELABEL_UNDO) {
            prelabelUndoStack.shift();
        }
    }

    function applyAcceptState(row, checked) {
        var checkbox = getAcceptCheckbox(row);
        if (!checkbox || checkbox.checked === checked) {
            return false;
        }

        checkbox.checked = !!checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function undoLastPrelabelAction() {
        if (prelabelUndoStack.length === 0) {
            showNotice(t('undoNoAction', 'No prelabel accept action to undo.'), 'warning');
            return false;
        }

        var action = prelabelUndoStack[prelabelUndoStack.length - 1];
        var row = getRowBySampleId(action.sampleId);
        if (!row || !isPrelabeledRow(row)) {
            prelabelUndoStack.pop();
            showNotice(t('undoConflict', 'The accept status changed again, cannot safely undo this action.'), 'warning');
            return false;
        }

        var checkbox = getAcceptCheckbox(row);
        if (!checkbox || checkbox.checked !== action.afterAccepted) {
            prelabelUndoStack.pop();
            showNotice(t('undoConflict', 'The accept status changed again, cannot safely undo this action.'), 'warning');
            return false;
        }

        prelabelUndoStack.pop();
        isApplyingPrelabelUndo = true;
        try {
            applyAcceptState(row, action.beforeAccepted);
        } finally {
            isApplyingPrelabelUndo = false;
        }
        showNotice(t('undoApplied', 'Undid prelabel accept status change.'));
        return true;
    }

    function tryShowSuggestions(input) {
        if (!input || typeof input.showPicker !== 'function') {
            return;
        }

        try {
            input.showPicker();
        } catch (err) {
            // Ignore unsupported invocation states and keep native input behavior.
        }
    }

    function bindAcceptCheckboxChanges() {
        document.querySelectorAll('.prelabel-accept').forEach(function (checkbox) {
            checkbox.addEventListener('change', function () {
                var row = checkbox.closest('tr[data-sample-id]');
                if (!row) {
                    return;
                }

                var wasAccepted = row.dataset.acceptedState === '1';
                var nowAccepted = checkbox.checked;

                if (nowAccepted && hasModifiedAttributes(row)) {
                    checkbox.checked = false;
                    syncRowVisualState(row);
                    syncAllRowsAndCount();
                    showModifiedAcceptanceWarning(row);
                    return;
                }

                if (nowAccepted) {
                    var uncertainState = row.querySelector('.uncertain-state');
                    var uncertainButton = row.querySelector('.uncertain-toggle');
                    if (uncertainState && uncertainState.value === '1') {
                        uncertainState.value = '0';
                    }
                    if (uncertainButton) {
                        var markLabel = uncertainButton.dataset.markLabel || 'Mark uncertain';
                        uncertainButton.setAttribute('aria-pressed', 'false');
                        uncertainButton.setAttribute('aria-label', markLabel);
                        uncertainButton.title = markLabel;
                        var hiddenLabel = uncertainButton.querySelector('span');
                        if (hiddenLabel) hiddenLabel.textContent = markLabel;
                    }
                }

                if (!isApplyingPrelabelUndo && !isCancelingAcceptanceForEdit && !isApplyingUncertainChange && wasAccepted !== nowAccepted) {
                    pushPrelabelUndoAction(row.dataset.sampleId, wasAccepted, nowAccepted);
                }

                syncRowVisualState(row);
                syncAllRowsAndCount();

                if (!isApplyingUncertainChange && nowAccepted && !wasAccepted) {
                    continueWorkflowAfterRow(row);
                } else if (!nowAccepted && wasAccepted) {
                    setActiveRow(row);
                }
            });
        });
    }

    function bindSpaceToAccept() {
        document.addEventListener('keydown', function (event) {
            if (event.key !== ' ' && event.code !== 'Space') {
                return;
            }

            if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                return;
            }

            if (hasOpenModal()) {
                return;
            }

            if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
                return;
            }

            var row = getCurrentActiveRow();
            if (!row) {
                return;
            }

            event.preventDefault();

            acceptReviewRow(row);
        });
    }

    function bindRowActivation(tableBody) {
        tableBody.addEventListener('click', function (event) {
            if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                return;
            }

            var row = event.target.closest('tr[data-sample-id]');
            if (!row) {
                return;
            }

            if (event.target.closest('.add-custom-label-btn, .sample-checkbox, .prelabel-status-cell, .prelabel-accept, a, button, select, textarea, label')) {
                return;
            }

            setActiveRow(row);
        });
    }

    function bindArrowNavigation() {
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                return;
            }

            if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                return;
            }

            if (hasOpenModal()) {
                return;
            }

            if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
                return;
            }

            var rows = getRows();
            if (rows.length === 0) {
                return;
            }

            var current = getCurrentActiveRow();
            var currentIndex = rows.indexOf(current);
            var nextIndex;

            if (currentIndex === -1) {
                nextIndex = event.key === 'ArrowUp' ? rows.length - 1 : 0;
            } else if (event.key === 'ArrowUp') {
                nextIndex = Math.max(0, currentIndex - 1);
            } else {
                nextIndex = Math.min(rows.length - 1, currentIndex + 1);
            }

            setActiveRow(rows[nextIndex], { scroll: true });
            event.preventDefault();
        });
    }

    function bindUndoShortcut() {
        document.addEventListener('keydown', function (event) {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey || event.altKey) {
                return;
            }

            if (hasOpenModal()) {
                return;
            }

            if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
                return;
            }

            var latestPrelabelAction = prelabelUndoStack.length > 0
                ? prelabelUndoStack[prelabelUndoStack.length - 1]
                : null;
            var clipboardApi = window.LabelingClipboard;
            var latestGeneralUndoAt = clipboardApi && typeof clipboardApi.getLatestUndoTimestamp === 'function'
                ? clipboardApi.getLatestUndoTimestamp()
                : 0;
            if (latestGeneralUndoAt > 0 && latestGeneralUndoAt >= (latestPrelabelAction ? latestPrelabelAction.createdAt : 0)) {
                return;
            }

            var undone = undoLastPrelabelAction();
            if (undone) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    function bindSelectionDrivenActivation() {
        document.addEventListener('change', function (event) {
            if (!event.target) {
                return;
            }

            if (!event.target.classList.contains('sample-checkbox') && event.target.id !== 'selectAllCheckbox') {
                return;
            }

            chooseActiveFromSelection();
        });
    }

    function bindSuggestionAutoOpen() {
        document.querySelectorAll('.attr-input').forEach(function (input) {
            input.addEventListener('focus', function () {
                var row = input.closest('tr[data-sample-id]');
                if (row) {
                    setActiveRow(row);
                }
                tryShowSuggestions(input);
                setTimeout(function () {
                    tryShowSuggestions(input);
                }, 120);
            });

            input.addEventListener('change', function () {
                var sampleId = input.dataset.sampleId;
                if (!sampleId) {
                    return;
                }
                if (window.rowNarrowed && Object.prototype.hasOwnProperty.call(window.rowNarrowed, sampleId)) {
                    window.rowNarrowed[sampleId] = false;
                }
            });
        });
    }

    function pickInitialActiveRow() {
        var first = getRows()[0];

        if (first) {
            setActiveRow(first);
        }
    }

    function initPrelabelReview() {
        var tableBody = document.getElementById('samplesTableBody');
        if (!tableBody) {
            return;
        }

        syncAllRowsAndCount();
        bindAcceptCheckboxChanges();
        bindSpaceToAccept();
        bindRowActivation(tableBody);
        bindArrowNavigation();
        bindUndoShortcut();
        bindSelectionDrivenActivation();
        bindSuggestionAutoOpen();
        pickInitialActiveRow();
    }

    function getVisibleRows() {
        return getRows().filter(function (row) {
            return !!row && row.offsetParent !== null;
        });
    }

    function getFirstVisibleRow() {
        var rows = getVisibleRows();
        return rows.length > 0 ? rows[0] : null;
    }

    function setActiveRowBySampleId(sampleId, options) {
        var row = getRowBySampleId(sampleId);
        if (row) {
            setActiveRow(row, options);
        }
        return row || null;
    }

    document.addEventListener('DOMContentLoaded', initPrelabelReview);

    window.LabelingPrelabelReview = {
        getRows: getRows,
        getVisibleRows: getVisibleRows,
        getRowBySampleId: getRowBySampleId,
        getCurrentActiveRow: getCurrentActiveRow,
        getFirstVisibleRow: getFirstVisibleRow,
        getAdjacentRow: getAdjacentRow,
        acceptReviewRow: acceptReviewRow,
        continueWorkflowAfterRow: continueWorkflowAfterRow,
        setActiveRow: setActiveRow,
        setActiveRowBySampleId: setActiveRowBySampleId,
        setAcceptanceForUncertain: setAcceptanceForUncertain,
        cancelAcceptanceForModifiedRow: cancelAcceptanceForModifiedRow,
        tryShowSuggestions: tryShowSuggestions,
        hasOpenModal: hasOpenModal
    };
})();
