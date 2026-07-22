(function () {
    'use strict';

    var ATTR_MIN = 1;
    var ATTR_MAX = 5;
    var SHORTCUT_HELP_PIN_KEY = 'labelingShortcutHelpPinned';
    var SHORTCUT_HELP_POSITION_KEY = 'labelingShortcutHelpPosition';
    var SHORTCUT_HELP_SIZE_KEY = 'labelingShortcutHelpSize';
    var SHORTCUT_HELP_MIN_WIDTH = 320;
    var SHORTCUT_HELP_MIN_HEIGHT = 220;
    var isSubmitting = false;
    var shortcutHelpPanel = null;
    var shortcutHelpHiddenForCustomLabel = false;
    var boundaryNoticeShown = {
        first: false,
        last: false
    };
    var plainAttrEnterPending = false;

    function getConfig() {
        return window.labelingKeyboardI18n || {};
    }

    function t(key, fallback) {
        var cfg = getConfig();
        return cfg[key] || fallback;
    }

    function getUserStorageKey(baseKey) {
        var cfg = getConfig();
        var userKey = String(cfg.layoutUserKey || 'anonymous');
        return baseKey + ':' + userKey;
    }

    function getStoredLayoutValue(baseKey) {
        var scopedKey = getUserStorageKey(baseKey);
        var value = window.localStorage.getItem(scopedKey);
        if (value !== null) {
            return value;
        }

        // One-time migration from the previous non-user-scoped preference keys.
        value = window.localStorage.getItem(baseKey);
        if (value !== null) {
            window.localStorage.setItem(scopedKey, value);
        }
        return value;
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

    function getReviewApi() {
        return window.LabelingPrelabelReview || null;
    }

    function hasOpenModal() {
        var api = getReviewApi();
        if (api && typeof api.hasOpenModal === 'function') {
            return api.hasOpenModal();
        }
        return !!document.querySelector('.modal.show');
    }

    function isAttrInput(element) {
        return !!(element && element.classList && element.classList.contains('attr-input'));
    }

    function inFilterForm(element) {
        return !!(element && element.closest && element.closest('#sampleFilterForm'));
    }

    function getVisibleRows() {
        var api = getReviewApi();
        if (api && typeof api.getVisibleRows === 'function') {
            return api.getVisibleRows();
        }
        return Array.from(document.querySelectorAll('tr[data-sample-id]')).filter(function (row) {
            return row.offsetParent !== null;
        });
    }

    function getActiveRow() {
        var api = getReviewApi();
        if (api && typeof api.getCurrentActiveRow === 'function') {
            return api.getCurrentActiveRow();
        }
        return document.querySelector('tr[data-sample-id].labeling-row-active');
    }

    function setActiveRow(row, options) {
        var api = getReviewApi();
        if (api && typeof api.setActiveRow === 'function') {
            api.setActiveRow(row, options || {});
            return;
        }

        if (!row) {
            return;
        }

        Array.from(document.querySelectorAll('tr[data-sample-id]')).forEach(function (candidate) {
            if (candidate === row) {
                candidate.classList.add('labeling-row-active');
            } else {
                candidate.classList.remove('labeling-row-active');
            }
        });

        if (options && options.scroll) {
            row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function getInputInRow(row, attrNum) {
        if (!row) {
            return null;
        }
        return row.querySelector('.attr-input[data-attr="' + attrNum + '"]');
    }

    function focusAttrInput(input) {
        if (!input) {
            return;
        }

        input.focus({ preventScroll: false });

        var api = getReviewApi();
        if (api && typeof api.tryShowSuggestions === 'function') {
            api.tryShowSuggestions(input);
            setTimeout(function () {
                api.tryShowSuggestions(input);
            }, 120);
        }
    }

    function focusSafeRowElement(row) {
        if (!row) {
            return;
        }

        var checkbox = row.querySelector('.sample-checkbox');
        if (checkbox && typeof checkbox.focus === 'function') {
            checkbox.focus({ preventScroll: true });
            return;
        }

        row.setAttribute('tabindex', '-1');
        row.focus({ preventScroll: true });
    }

    function resetBoundaryNoticeFlags() {
        boundaryNoticeShown.first = false;
        boundaryNoticeShown.last = false;
    }

    function enterEditMode() {
        var row = getActiveRow();
        if (!row) {
            var rows = getVisibleRows();
            row = rows.length > 0 ? rows[0] : null;
        }

        if (!row) {
            showNotice(t('noEditableData', 'No editable records on current page.'), 'warning');
            return;
        }

        setActiveRow(row, { scroll: true });

        var targetInput = getInputInRow(row, 1) || row.querySelector('.attr-input');
        if (!targetInput) {
            showNotice(t('noEditableData', 'No editable records on current page.'), 'warning');
            return;
        }

        focusAttrInput(targetInput);
        resetBoundaryNoticeFlags();
    }

    function enterEditRow(row) {
        if (!row) {
            return false;
        }

        var targetInput = getInputInRow(row, 1) || row.querySelector('.attr-input');
        if (!targetInput) {
            return false;
        }

        setActiveRow(row, { scroll: true });
        focusAttrInput(targetInput);
        resetBoundaryNoticeFlags();
        return true;
    }

    function isPrelabeledRow(row) {
        return !!(row && row.dataset && row.dataset.status === 'Prelabeled');
    }

    function enterReviewRow(row) {
        if (!row) {
            return false;
        }

        setActiveRow(row, { scroll: true });
        focusSafeRowElement(row);
        resetBoundaryNoticeFlags();
        return true;
    }

    function exitEditMode(input) {
        if (!isAttrInput(input)) {
            return;
        }

        var row = input.closest('tr[data-sample-id]');

        input.blur();
        if (typeof window.updateInputValidation === 'function') {
            window.updateInputValidation(input);
        }

        if (row) {
            setActiveRow(row);
            focusSafeRowElement(row);
        }
    }

    function getNextPosition(rows, rowIndex, attrNum, isBackward) {
        var nextRowIndex = rowIndex;
        var nextAttrNum = attrNum;

        if (isBackward) {
            if (attrNum > ATTR_MIN) {
                nextAttrNum = attrNum - 1;
            } else if (rowIndex > 0) {
                nextRowIndex = rowIndex - 1;
                nextAttrNum = ATTR_MAX;
            } else {
                return null;
            }
        } else if (attrNum < ATTR_MAX) {
            nextAttrNum = attrNum + 1;
        } else if (rowIndex < rows.length - 1) {
            nextRowIndex = rowIndex + 1;
            nextAttrNum = ATTR_MIN;
        } else {
            return null;
        }

        return {
            rowIndex: nextRowIndex,
            attrNum: nextAttrNum
        };
    }

    function showBoundaryNotice(isBackward) {
        if (isBackward) {
            if (!boundaryNoticeShown.first) {
                showNotice(t('alreadyFirstRecord', 'Already at the first record on current page.'), 'info');
                boundaryNoticeShown.first = true;
            }
            return;
        }

        if (!boundaryNoticeShown.last) {
            showNotice(t('alreadyLastRecord', 'Already at the last record on current page.'), 'info');
            boundaryNoticeShown.last = true;
        }
    }

    function moveAttrFocusByTab(currentInput, isBackward) {
        var row = currentInput.closest('tr[data-sample-id]');
        var attrNum = parseInt(currentInput.dataset.attr, 10);
        if (!row || !attrNum) {
            return;
        }

        var rows = getVisibleRows();
        var rowIndex = rows.indexOf(row);
        if (rowIndex === -1) {
            return;
        }

        var nextPosition = getNextPosition(rows, rowIndex, attrNum, isBackward);
        if (!nextPosition) {
            showBoundaryNotice(isBackward);
            return;
        }

        var nextRow = rows[nextPosition.rowIndex];

        if (!isBackward && attrNum === ATTR_MAX && isPrelabeledRow(nextRow)) {
            enterReviewRow(nextRow);
            return;
        }

        var nextInput = getInputInRow(nextRow, nextPosition.attrNum);
        if (!nextInput) {
            return;
        }

        boundaryNoticeShown.first = false;
        boundaryNoticeShown.last = false;
        setActiveRow(nextRow, { scroll: nextPosition.rowIndex !== rowIndex });
        focusAttrInput(nextInput);
    }

    function advanceAfterLabelCommit(input) {
        if (!isAttrInput(input) || !document.contains(input)) {
            return false;
        }

        var value = (input.value || '').trim();
        if (!value) {
            return false;
        }

        if (typeof window.isValidOption === 'function' && !window.isValidOption(input.dataset.attr, value)) {
            return false;
        }

        moveAttrFocusByTab(input, false);
        return true;
    }

    function setSubmittingState(submitting) {
        isSubmitting = !!submitting;

        var saveBtn = document.getElementById('saveCurrentPageBtn');
        if (!saveBtn) {
            return;
        }

        if (!saveBtn.dataset.defaultText) {
            saveBtn.dataset.defaultText = saveBtn.innerHTML;
        }

        if (isSubmitting) {
            saveBtn.disabled = true;
            saveBtn.classList.add('is-submitting');
            var savingText = saveBtn.dataset.savingText || t('savingInProgress', 'Saving, please do not submit again.');
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + savingText;
        } else {
            saveBtn.disabled = false;
            saveBtn.classList.remove('is-submitting');
            saveBtn.innerHTML = saveBtn.dataset.defaultText;
        }
    }

    function requestPageSave(trigger) {
        var form = document.getElementById('batchEditForm');
        if (!form) {
            return false;
        }

        if (isSubmitting) {
            showNotice(t('savingInProgress', 'Saving, please do not submit again.'), 'warning');
            return false;
        }

        form.requestSubmit();
        return true;
    }

    function bindF2Toggle() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented) {
                return;
            }

            if (event.key !== 'F2') {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                return;
            }

            if (hasOpenModal()) {
                return;
            }

            var active = document.activeElement || event.target;
            if (inFilterForm(active)) {
                return;
            }

            event.preventDefault();

            if (isAttrInput(active)) {
                exitEditMode(active);
            } else {
                enterEditMode();
            }
        });
    }

    function bindTabNavigation() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented) {
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            if (hasOpenModal()) {
                return;
            }

            var target = event.target;
            if (!isAttrInput(target)) {
                return;
            }

            event.preventDefault();
            moveAttrFocusByTab(target, !!event.shiftKey);
        });
    }

    function bindCtrlEnterSave() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented) {
                return;
            }

            var isCtrlEnter = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
            if (!isCtrlEnter || event.shiftKey || event.altKey) {
                return;
            }

            if (hasOpenModal()) {
                return;
            }

            var active = document.activeElement || event.target;
            var activeForm = active && active.closest ? active.closest('form') : null;
            if (activeForm && activeForm.id === 'sampleFilterForm') {
                event.preventDefault();
                activeForm.requestSubmit();
                return;
            }

            event.preventDefault();
            requestPageSave('ctrl-enter');
        });
    }

    function bindAttributeEnterBehavior() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented || event.key !== 'Enter' || hasOpenModal()) {
                return;
            }

            var target = event.target;
            if (isAttrInput(target) && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                var addLabelButton = target.parentElement
                    ? target.parentElement.querySelector('.add-custom-label-btn')
                    : null;
                if (!addLabelButton) {
                    return;
                }

                event.preventDefault();
                addLabelButton.click();
                return;
            }

            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                return;
            }

            if (isAttrInput(target)) {
                // Keep native datalist selection behavior, but suppress the input's
                // implicit form submission if the browser emits one for Enter. Move
                // only after the browser has committed a valid datalist value.
                plainAttrEnterPending = true;
                setTimeout(function () {
                    plainAttrEnterPending = false;
                    if (document.activeElement === target) {
                        advanceAfterLabelCommit(target);
                    }
                }, 0);
                return;
            }

            var active = document.activeElement || target;
            if (inFilterForm(active) || active.closest('#labelingShortcutHelp')) {
                return;
            }

            if (active.matches('a, button, textarea, select, [contenteditable="true"]') ||
                (active.tagName === 'INPUT' && active.type !== 'checkbox')) {
                return;
            }

            event.preventDefault();
            enterEditMode();
        });

        var form = document.getElementById('batchEditForm');
        if (form) {
            form.addEventListener('submit', function (event) {
                if (!plainAttrEnterPending) {
                    return;
                }

                plainAttrEnterPending = false;
                event.preventDefault();
                event.stopImmediatePropagation();
            }, true);
        }
    }

    function bindClearCurrentRow() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented || event.key !== 'Delete') {
                return;
            }

            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || hasOpenModal()) {
                return;
            }

            var active = document.activeElement || event.target;
            if (inFilterForm(active)) {
                return;
            }

            var row = isAttrInput(active) ? active.closest('tr[data-sample-id]') : getActiveRow();
            var selectedRows = document.querySelectorAll('.sample-checkbox:checked').length;
            if (selectedRows === 0 && (!row || !row.dataset || !row.dataset.sampleId)) {
                showNotice(t('noActiveRowToClear', 'No active row to clear.'), 'warning');
                return;
            }

            var clipboardApi = window.LabelingClipboard;
            if (!clipboardApi || typeof clipboardApi.clearSelectionOrRowAttributes !== 'function') {
                return;
            }

            event.preventDefault();
            clipboardApi.clearSelectionOrRowAttributes(row && row.dataset ? row.dataset.sampleId : '');
        });
    }

    function bindUncertainToggle() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented || hasOpenModal()) {
                return;
            }

            var isCtrlU = (event.ctrlKey || event.metaKey) &&
                !event.shiftKey &&
                !event.altKey &&
                event.key.toLowerCase() === 'u';
            if (!isCtrlU) {
                return;
            }

            var active = document.activeElement || event.target;
            if (inFilterForm(active) || (active.closest && active.closest('#labelingShortcutHelp'))) {
                return;
            }

            var row = isAttrInput(active) ? active.closest('tr[data-sample-id]') : getActiveRow();
            var progressApi = window.LabelingRowProgress;
            if (!row || !progressApi || typeof progressApi.toggleUncertainForRow !== 'function') {
                showNotice(t('noActiveRowToMarkUncertain', 'Select a row before marking it uncertain.'), 'warning');
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            var transactionState = progressApi.toggleUncertainForRow(row);
            if (!transactionState) {
                return;
            }

            if (transactionState.afterUncertain) {
                var reviewApi = getReviewApi();
                if (reviewApi && typeof reviewApi.continueWorkflowAfterRow === 'function') {
                    reviewApi.continueWorkflowAfterRow(row);
                }
            }
        }, true);
    }

    function bindEditModeReviewShortcuts() {
        document.addEventListener('keydown', function (event) {
            if (event.defaultPrevented || hasOpenModal()) {
                return;
            }

            if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) {
                return;
            }

            var input = isAttrInput(event.target) ? event.target : document.activeElement;
            if (!isAttrInput(input)) {
                return;
            }

            var reviewApi = getReviewApi();
            if (!reviewApi) {
                return;
            }

            var row = input.closest('tr[data-sample-id]');
            if (!row) {
                return;
            }

            if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
                if (typeof reviewApi.acceptReviewRow !== 'function') {
                    return;
                }
                event.preventDefault();
                reviewApi.acceptReviewRow(row);
                return;
            }

            var isArrowUp = event.key === 'ArrowUp' || event.code === 'ArrowUp';
            var isArrowDown = event.key === 'ArrowDown' || event.code === 'ArrowDown';
            if (!isArrowUp && !isArrowDown) {
                return;
            }

            if (typeof reviewApi.getAdjacentRow !== 'function') {
                return;
            }

            event.preventDefault();
            var direction = isArrowUp ? -1 : 1;
            var nextRow = reviewApi.getAdjacentRow(row, direction);
            if (!nextRow || nextRow === row) {
                return;
            }

            var attrNum = parseInt(input.dataset.attr, 10) || ATTR_MIN;
            var nextInput = getInputInRow(nextRow, attrNum) || getInputInRow(nextRow, ATTR_MIN);
            if (!nextInput) {
                return;
            }

            setActiveRow(nextRow, { scroll: true });
            focusAttrInput(nextInput);
        }, true);
    }

    function getShortcutHelpPinned() {
        try {
            return getStoredLayoutValue(SHORTCUT_HELP_PIN_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    function setShortcutHelpPinned(pinned) {
        try {
            window.localStorage.setItem(getUserStorageKey(SHORTCUT_HELP_PIN_KEY), pinned ? '1' : '0');
        } catch (error) {
            // Keep the setting for this view even when browser storage is unavailable.
        }
    }

    function getShortcutHelpPosition() {
        try {
            var stored = JSON.parse(getStoredLayoutValue(SHORTCUT_HELP_POSITION_KEY));
            if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
                return stored;
            }
        } catch (error) {
            // Ignore invalid or unavailable browser storage.
        }
        return null;
    }

    function setShortcutHelpPosition(left, top) {
        try {
            window.localStorage.setItem(getUserStorageKey(SHORTCUT_HELP_POSITION_KEY), JSON.stringify({
                left: Math.round(left),
                top: Math.round(top)
            }));
        } catch (error) {
            // Keep the dragged position for this view when storage is unavailable.
        }
    }

    function getShortcutHelpSize() {
        try {
            var stored = JSON.parse(window.localStorage.getItem(getUserStorageKey(SHORTCUT_HELP_SIZE_KEY)));
            if (stored && Number.isFinite(stored.width) && Number.isFinite(stored.height)) {
                return stored;
            }
        } catch (error) {
            // Ignore invalid or unavailable browser storage.
        }
        return null;
    }

    function setShortcutHelpSize(width, height) {
        try {
            window.localStorage.setItem(getUserStorageKey(SHORTCUT_HELP_SIZE_KEY), JSON.stringify({
                width: Math.round(width),
                height: Math.round(height)
            }));
        } catch (error) {
            // Keep the resized dimensions for this view when storage is unavailable.
        }
    }

    function constrainShortcutHelpSize(width, height, limits) {
        var margin = 8;
        var availableWidth = Math.max(1, limits && limits.maxWidth ? limits.maxWidth : window.innerWidth - margin * 2);
        var availableHeight = Math.max(1, limits && limits.maxHeight ? limits.maxHeight : window.innerHeight - margin * 2);
        var minWidth = Math.min(SHORTCUT_HELP_MIN_WIDTH, availableWidth);
        var minHeight = Math.min(SHORTCUT_HELP_MIN_HEIGHT, availableHeight);
        return {
            width: Math.min(Math.max(minWidth, width), availableWidth),
            height: Math.min(Math.max(minHeight, height), availableHeight)
        };
    }

    function applyShortcutHelpSize(panel, size, limits) {
        if (!size) {
            return;
        }
        var constrained = constrainShortcutHelpSize(size.width, size.height, limits);
        panel.style.width = constrained.width + 'px';
        panel.style.height = constrained.height + 'px';
        panel.style.maxHeight = 'none';
    }

    function constrainShortcutHelpPosition(panel, left, top) {
        var margin = 8;
        var maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
        var maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
        return {
            left: Math.min(Math.max(margin, left), maxLeft),
            top: Math.min(Math.max(margin, top), maxTop)
        };
    }

    function applyShortcutHelpPosition(panel, position) {
        if (!position) {
            return;
        }
        var constrained = constrainShortcutHelpPosition(panel, position.left, position.top);
        panel.style.left = constrained.left + 'px';
        panel.style.top = constrained.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';
    }

    function bindShortcutHelpDragging(panel, handle) {
        var dragState = null;

        handle.addEventListener('pointerdown', function (event) {
            if (event.button !== 0 || event.target.closest('button, input, label, a')) {
                return;
            }

            var rect = panel.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };
            panel.classList.add('is-dragging');
            applyShortcutHelpPosition(panel, { left: rect.left, top: rect.top });
            if (handle.setPointerCapture) {
                handle.setPointerCapture(event.pointerId);
            }
            event.preventDefault();
        });

        handle.addEventListener('pointermove', function (event) {
            if (!dragState || event.pointerId !== dragState.pointerId) {
                return;
            }
            applyShortcutHelpPosition(panel, {
                left: event.clientX - dragState.offsetX,
                top: event.clientY - dragState.offsetY
            });
        });

        function finishDrag(event) {
            if (!dragState || (event && event.pointerId !== dragState.pointerId)) {
                return;
            }
            var rect = panel.getBoundingClientRect();
            setShortcutHelpPosition(rect.left, rect.top);
            panel.classList.remove('is-dragging');
            dragState = null;
        }

        handle.addEventListener('pointerup', finishDrag);
        handle.addEventListener('pointercancel', finishDrag);
    }

    function bindShortcutHelpResizing(panel, handle) {
        var resizeState = null;

        handle.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) {
                return;
            }

            var rect = panel.getBoundingClientRect();
            resizeState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startWidth: rect.width,
                startHeight: rect.height,
                maxWidth: window.innerWidth - rect.left - 8,
                maxHeight: window.innerHeight - rect.top - 8
            };
            panel.classList.add('is-resizing');
            applyShortcutHelpPosition(panel, { left: rect.left, top: rect.top });
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        });

        handle.addEventListener('pointermove', function (event) {
            if (!resizeState || event.pointerId !== resizeState.pointerId) {
                return;
            }
            applyShortcutHelpSize(panel, {
                width: resizeState.startWidth + event.clientX - resizeState.startX,
                height: resizeState.startHeight + event.clientY - resizeState.startY
            }, {
                maxWidth: resizeState.maxWidth,
                maxHeight: resizeState.maxHeight
            });
        });

        function finishResize(event) {
            if (!resizeState || event.pointerId !== resizeState.pointerId) {
                return;
            }
            var rect = panel.getBoundingClientRect();
            setShortcutHelpSize(rect.width, rect.height);
            setShortcutHelpPosition(rect.left, rect.top);
            panel.classList.remove('is-resizing');
            resizeState = null;
        }

        handle.addEventListener('pointerup', finishResize);
        handle.addEventListener('pointercancel', finishResize);
    }

    function appendShortcutItem(container, keys, description) {
        var item = document.createElement('div');
        item.className = 'labeling-shortcut-item';

        var keyGroup = document.createElement('div');
        keyGroup.className = 'labeling-shortcut-keys';
        keys.forEach(function (key) {
            var keyElement = document.createElement('kbd');
            keyElement.textContent = key;
            keyGroup.appendChild(keyElement);
        });

        var text = document.createElement('div');
        text.className = 'labeling-shortcut-description';
        text.textContent = description;

        item.appendChild(keyGroup);
        item.appendChild(text);
        container.appendChild(item);
    }

    function appendShortcutSection(container, titleText, shortcuts) {
        var section = document.createElement('section');
        section.className = 'labeling-shortcut-section';

        var title = document.createElement('h3');
        title.className = 'labeling-shortcut-section-title';
        title.textContent = titleText;
        section.appendChild(title);

        var items = document.createElement('div');
        items.className = 'labeling-shortcut-section-items';
        shortcuts.forEach(function (shortcut) {
            appendShortcutItem(items, shortcut.keys, shortcut.description);
        });
        section.appendChild(items);
        container.appendChild(section);
    }

    function createShortcutHelpPanel() {
        if (shortcutHelpPanel) {
            return shortcutHelpPanel;
        }

        var panel = document.createElement('aside');
        panel.id = 'labelingShortcutHelp';
        panel.className = 'labeling-shortcut-help d-none';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'labelingShortcutHelpTitle');

        var header = document.createElement('div');
        header.className = 'labeling-shortcut-header';
        header.title = t('shortcutHelpDrag', 'Drag this header to move the panel');

        var title = document.createElement('h2');
        title.id = 'labelingShortcutHelpTitle';
        title.className = 'h6 mb-0';
        title.textContent = t('shortcutHelpTitle', 'Keyboard shortcuts');

        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'btn-close';
        closeButton.setAttribute('aria-label', t('shortcutHelpClose', 'Close shortcut help'));
        closeButton.addEventListener('click', function () {
            panel.classList.add('d-none');
        });

        header.appendChild(title);
        header.appendChild(closeButton);
        bindShortcutHelpDragging(panel, header);

        var list = document.createElement('div');
        list.className = 'labeling-shortcut-list';
        appendShortcutSection(list, t('shortcutGroupCommon', 'Common actions'), [
            { keys: ['Ctrl+Enter'], description: t('shortcutSave', 'Save the current page') },
            { keys: ['Space'], description: t('shortcutSpace', 'Accept the active prelabeled row') },
            { keys: ['Ctrl+C', 'Ctrl+V'], description: t('shortcutCopyPaste', 'Copy or paste selected labels') },
            { keys: ['Alt+Delete'], description: t('shortcutClearRow', 'Clear the selected range or current row') },
            { keys: ['Ctrl+Z'], description: t('shortcutUndo', 'Undo the most recent labeling action') },
            { keys: ['Alt+Enter'], description: t('shortcutNewLabel', 'Create a new label for the current attribute') },
            { keys: ['Ctrl+U'], description: t('shortcutUncertain', 'Mark or unmark the active row as uncertain') }
        ]);
        appendShortcutSection(list, t('shortcutGroupEditing', 'Editing and navigation'), [
            { keys: ['F2'], description: t('shortcutF2', 'Enter or exit attribute editing') },
            { keys: ['Tab', 'Shift+Tab'], description: t('shortcutTab', 'Move between attributes and rows') },
            { keys: ['↑', '↓'], description: t('shortcutArrows', 'Move the active review row') }
        ]);

        var footer = document.createElement('label');
        footer.className = 'labeling-shortcut-pin';

        var pinCheckbox = document.createElement('input');
        pinCheckbox.type = 'checkbox';
        pinCheckbox.className = 'form-check-input';
        pinCheckbox.checked = getShortcutHelpPinned();
        pinCheckbox.addEventListener('change', function () {
            setShortcutHelpPinned(pinCheckbox.checked);
            panel.classList.toggle('is-pinned', pinCheckbox.checked);
        });

        var pinText = document.createElement('span');
        pinText.textContent = t('shortcutHelpPin', 'Keep floating on the page');
        footer.appendChild(pinCheckbox);
        footer.appendChild(pinText);

        var resizeHandle = document.createElement('div');
        resizeHandle.className = 'labeling-shortcut-resize-handle';
        resizeHandle.setAttribute('role', 'separator');
        resizeHandle.setAttribute('aria-label', t('shortcutHelpResize', 'Drag to resize the panel'));
        resizeHandle.title = t('shortcutHelpResize', 'Drag to resize the panel');
        bindShortcutHelpResizing(panel, resizeHandle);

        panel.classList.toggle('is-pinned', pinCheckbox.checked);
        panel.appendChild(header);
        panel.appendChild(list);
        panel.appendChild(footer);
        panel.appendChild(resizeHandle);
        document.body.appendChild(panel);
        shortcutHelpPanel = panel;
        applyShortcutHelpSize(panel, getShortcutHelpSize());
        applyShortcutHelpPosition(panel, getShortcutHelpPosition());
        return panel;
    }

    function toggleShortcutHelp() {
        var panel = createShortcutHelpPanel();
        var willShow = panel.classList.contains('d-none');
        panel.classList.toggle('d-none');
        if (willShow) {
            applyShortcutHelpPosition(panel, getShortcutHelpPosition());
        }
    }

    function bindShortcutHelp() {
        var panel = createShortcutHelpPanel();
        var trigger = document.getElementById('labelingShortcutTrigger');
        if (trigger) {
            trigger.addEventListener('click', toggleShortcutHelp);
        }
        if (getShortcutHelpPinned()) {
            panel.classList.remove('d-none');
            applyShortcutHelpPosition(panel, getShortcutHelpPosition());
        }

        document.addEventListener('keydown', function (event) {
            var isSlashKey = event.code === 'Slash' ||
                event.key === '/' ||
                event.key === '?' ||
                event.keyCode === 191;
            var isHelpShortcut = (event.ctrlKey || event.metaKey) &&
                !event.altKey &&
                isSlashKey;
            if (!isHelpShortcut || hasOpenModal()) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            toggleShortcutHelp();
        }, true);

        document.addEventListener('pointerdown', function (event) {
            if (!shortcutHelpPanel || shortcutHelpPanel.classList.contains('d-none')) {
                return;
            }
            if (getShortcutHelpPinned() || shortcutHelpPanel.contains(event.target) ||
                (trigger && trigger.contains(event.target))) {
                return;
            }
            shortcutHelpPanel.classList.add('d-none');
        });

        window.addEventListener('resize', function () {
            if (!shortcutHelpPanel || shortcutHelpPanel.classList.contains('d-none')) {
                return;
            }
            var savedSize = getShortcutHelpSize();
            if (savedSize) {
                applyShortcutHelpSize(shortcutHelpPanel, savedSize);
            }
            var rect = shortcutHelpPanel.getBoundingClientRect();
            applyShortcutHelpPosition(shortcutHelpPanel, { left: rect.left, top: rect.top });
        });

        var customLabelModal = document.getElementById('customLabelModal');
        if (customLabelModal) {
            customLabelModal.addEventListener('show.bs.modal', function () {
                shortcutHelpHiddenForCustomLabel = !panel.classList.contains('d-none');
                if (shortcutHelpHiddenForCustomLabel) {
                    panel.classList.add('d-none');
                }
            });

            customLabelModal.addEventListener('hidden.bs.modal', function () {
                if (!shortcutHelpHiddenForCustomLabel) {
                    return;
                }
                shortcutHelpHiddenForCustomLabel = false;
                panel.classList.remove('d-none');
                applyShortcutHelpPosition(panel, getShortcutHelpPosition());
            });
        }
    }

    function bindSubmitGuard() {
        var form = document.getElementById('batchEditForm');
        if (!form) {
            return;
        }

        form.addEventListener('submit', function (event) {
            if (isSubmitting) {
                event.preventDefault();
                showNotice(t('savingInProgress', 'Saving, please do not submit again.'), 'warning');
                return;
            }

            // If upstream validation/confirmation blocks submit, keep form reusable.
            if (event.defaultPrevented) {
                setSubmittingState(false);
                return;
            }

            setSubmittingState(true);
        });
    }

    function bindPageRestore() {
        window.addEventListener('pageshow', function () {
            setSubmittingState(false);
        });
    }

    function init() {
        bindF2Toggle();
        bindTabNavigation();
        bindCtrlEnterSave();
        bindAttributeEnterBehavior();
        bindClearCurrentRow();
        bindUncertainToggle();
        bindEditModeReviewShortcuts();
        bindShortcutHelp();
        bindSubmitGuard();
        bindPageRestore();
    }

    document.addEventListener('DOMContentLoaded', init);

    window.LabelingKeyboardNavigation = {
        requestPageSave: requestPageSave,
        enterEditRow: enterEditRow,
        enterReviewRow: enterReviewRow,
        advanceAfterLabelCommit: advanceAfterLabelCommit,
        isSubmitting: function () {
            return isSubmitting;
        }
    };
})();
