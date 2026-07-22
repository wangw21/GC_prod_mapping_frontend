(function () {
    'use strict';

    var ATTR_COUNT = 5;
    var MAX_UNDO_STACK = 20;
    var TOAST_DELAY_MS = 5000;
    var rangeAnchorIndex = null;
    var toastContainer = null;
    var undoStack = [];
    var inputEditBeforeMap = {};
    var isApplyingClipboardOperation = false;
    var lastOperationType = 'none';
    var suppressNextClick = false;
    var ctrlDragState = null;
    var dragAutoScrollFrame = null;
    var activeAttrRangeSelection = null;
    var rowSelectionAttrNums = [1, 2, 3, 4, 5];
    var copiedAttrNums = [1, 2, 3, 4, 5];
    var DRAG_THRESHOLD_PX = 7;
    var DIRECTION_RATIO = 1.5;
    var AUTO_SCROLL_EDGE_PX = 72;
    var AUTO_SCROLL_MAX_PX = 5;

    var HEADER_ALIAS_TO_ATTR = {
        'attribute 1': 1,
        'prod_attributes1': 1,
        'attribute 2': 2,
        'prod_attributes2': 2,
        'attribute 3': 3,
        'prod_attributes3': 3,
        'attribute 4': 4,
        'prod_attributes4': 4,
        'attribute 5': 5,
        'prod_attributes5': 5
    };

    function getConfig() {
        return window.labelingClipboardI18n || {};
    }

    function t(key, fallback) {
        var cfg = getConfig();
        return cfg[key] || fallback;
    }

    function formatMessage(template, replacements) {
        var message = template;
        Object.keys(replacements).forEach(function (k) {
            message = message.replace(new RegExp('\\{' + k + '\\}', 'g'), String(replacements[k]));
        });
        return message;
    }

    function ensureToastContainer() {
        if (toastContainer) {
            return toastContainer;
        }
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3 clipboard-toast-container';
        toastContainer.style.zIndex = '1080';
        document.body.appendChild(toastContainer);
        return toastContainer;
    }

    function showClipboardToast(message, type) {
        var toastType = type || 'info';
        var container = ensureToastContainer();
        var toastEl = document.createElement('div');
        var content = document.createElement('div');
        var icon = document.createElement('span');
        var body = document.createElement('div');
        var closeButton = document.createElement('button');

        toastEl.className = 'toast clipboard-toast clipboard-toast--' + toastType;
        toastEl.setAttribute('role', toastType === 'warning' ? 'alert' : 'status');
        toastEl.setAttribute('aria-live', toastType === 'warning' ? 'assertive' : 'polite');
        toastEl.setAttribute('aria-atomic', 'true');

        content.className = 'clipboard-toast-content';
        icon.className = 'clipboard-toast-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = toastType === 'warning' ? '!' : '✓';
        body.className = 'toast-body';
        body.textContent = message;
        closeButton.type = 'button';
        closeButton.className = 'btn-close clipboard-toast-close';
        closeButton.setAttribute('data-bs-dismiss', 'toast');
        closeButton.setAttribute('aria-label', 'Close');

        content.appendChild(icon);
        content.appendChild(body);
        content.appendChild(closeButton);
        toastEl.appendChild(content);

        container.appendChild(toastEl);

        if (window.bootstrap && window.bootstrap.Toast) {
            var toast = new window.bootstrap.Toast(toastEl, {
                delay: toastType === 'warning' ? TOAST_DELAY_MS : 3200
            });
            toast.show();
            toastEl.addEventListener('hidden.bs.toast', function () {
                toastEl.remove();
            });
        } else {
            // Fallback for environments without Bootstrap Toast.
            setTimeout(function () {
                toastEl.remove();
            }, TOAST_DELAY_MS);
        }
    }

    function normalizeClipboardRows(text) {
        var normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var rows = normalized.split('\n');

        // Excel often appends trailing line breaks; remove trailing empty rows only.
        while (rows.length > 0 && rows[rows.length - 1] === '') {
            rows.pop();
        }

        return rows;
    }

    function getMaxColumnCount(matrix) {
        var maxCount = 0;
        matrix.forEach(function (row) {
            if (row.length > maxCount) {
                maxCount = row.length;
            }
        });
        return maxCount;
    }

    function parseClipboardMatrix(text) {
        var rows = normalizeClipboardRows(text);
        if (rows.length === 0) {
            return {
                rawText: text || '',
                matrix: [],
                sourceRowCount: 0,
                sourceMaxColCount: 0,
                singlePlainValue: false
            };
        }

        var matrix = rows.map(function (row) {
            var cells = row.split('\t');
            // Excel can include empty cells to the right of the copied attribute
            // range. Ignore only overflow cells that are empty; meaningful empty
            // cells inside Attribute 1-5 must remain available for clearing.
            while (cells.length > ATTR_COUNT && cells[cells.length - 1] === '') {
                cells.pop();
            }
            return cells;
        });

        var singlePlainValue = /	|\n|\r/.test(text || '') === false &&
            matrix.length === 1 &&
            matrix[0].length === 1;

        return {
            rawText: text || '',
            matrix: matrix,
            sourceRowCount: matrix.length,
            sourceMaxColCount: getMaxColumnCount(matrix),
            singlePlainValue: singlePlainValue
        };
    }

    function normalizeHeaderToken(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function isHeaderRow(values) {
        if (!Array.isArray(values) || values.length !== ATTR_COUNT) {
            return false;
        }

        var normalized = values.map(normalizeHeaderToken);
        var attrHeader = ['attribute 1', 'attribute 2', 'attribute 3', 'attribute 4', 'attribute 5'];
        var prodHeader = ['prod_attributes1', 'prod_attributes2', 'prod_attributes3', 'prod_attributes4', 'prod_attributes5'];

        var isAttr = attrHeader.every(function (token, index) {
            return normalized[index] === token;
        });
        var isProd = prodHeader.every(function (token, index) {
            return normalized[index] === token;
        });

        return isAttr || isProd;
    }

    function detectHeaderMapping(matrix) {
        if (!Array.isArray(matrix) || matrix.length === 0) {
            return {
                hasHeader: false,
                rowOffset: 0,
                attrToColumn: {},
                attrNums: []
            };
        }

        var firstRow = matrix[0] || [];
        var attrToColumn = {};
        var foundAttrs = [];

        for (var col = 0; col < firstRow.length; col += 1) {
            var normalized = normalizeHeaderToken(firstRow[col]);
            var attrNum = HEADER_ALIAS_TO_ATTR[normalized];
            if (!attrNum) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(attrToColumn, attrNum)) {
                return {
                    error: true,
                    errorMessage: t('toastDuplicateHeader', 'Duplicate attribute headers detected. Paste was canceled.')
                };
            }
            attrToColumn[attrNum] = col;
            foundAttrs.push(attrNum);
        }

        if (foundAttrs.length === 0) {
            return {
                hasHeader: false,
                rowOffset: 0,
                attrToColumn: {},
                attrNums: []
            };
        }

        foundAttrs.sort(function (a, b) { return a - b; });
        return {
            hasHeader: true,
            rowOffset: 1,
            attrToColumn: attrToColumn,
            attrNums: foundAttrs
        };
    }

    function extractAttributeMatrix(matrix, mapping) {
        var rows = [];
        var sourceMaxColCount = 0;

        if (mapping.hasHeader) {
            for (var i = mapping.rowOffset; i < matrix.length; i += 1) {
                var sourceRowWithHeader = matrix[i] || [];
                var attrValues = {};
                mapping.attrNums.forEach(function (attrNum) {
                    var colIndex = mapping.attrToColumn[attrNum];
                    attrValues[attrNum] = colIndex < sourceRowWithHeader.length ? sourceRowWithHeader[colIndex] : '';
                });
                rows.push({
                    attrValues: attrValues,
                    providedAttrNums: mapping.attrNums.slice()
                });
            }
            sourceMaxColCount = mapping.attrNums.length;
        } else {
            matrix.forEach(function (sourceRowNoHeader) {
                var attrValuesNoHeader = {};
                var providedAttrNumsNoHeader = [];

                for (var colNoHeader = 0; colNoHeader < sourceRowNoHeader.length; colNoHeader += 1) {
                    var sourceAttrNum = colNoHeader + 1;
                    attrValuesNoHeader[sourceAttrNum] = sourceRowNoHeader[colNoHeader];
                    providedAttrNumsNoHeader.push(sourceAttrNum);
                }

                rows.push({
                    attrValues: attrValuesNoHeader,
                    providedAttrNums: providedAttrNumsNoHeader
                });
            });
            sourceMaxColCount = getMaxColumnCount(matrix);
        }

        return {
            rows: rows,
            sourceRowCount: rows.length,
            sourceMaxColCount: sourceMaxColCount
        };
    }

    function parseClipboardText(text) {
        var parsed = parseClipboardMatrix(text);
        if (parsed.sourceRowCount === 0) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        if (parsed.singlePlainValue) {
            return {
                singleValue: true,
                values: [parsed.matrix[0][0]]
            };
        }

        var mapping = detectHeaderMapping(parsed.matrix);
        if (mapping.error) {
            return {
                error: true,
                errorMessage: mapping.errorMessage
            };
        }

        var extracted = extractAttributeMatrix(parsed.matrix, mapping);
        if (extracted.sourceRowCount === 0) {
            return {
                error: true,
                errorMessage: t('toastSingleGroupOnly', 'Current quick paste supports only one attribute group')
            };
        }

        if (extracted.sourceRowCount > 1) {
            return {
                error: true,
                errorMessage: t('toastMultiRowNotSupported', 'Current quick paste supports only one attribute group, please copy one row only.')
            };
        }

        var values = [];
        for (var attrNum = 1; attrNum <= ATTR_COUNT; attrNum += 1) {
            if (Object.prototype.hasOwnProperty.call(extracted.rows[0].attrValues, attrNum)) {
                values.push(extracted.rows[0].attrValues[attrNum]);
            }
        }

        return {
            singleValue: false,
            values: values
        };
    }

    function getRowAttributeInputs(sampleId) {
        var inputs = [];
        for (var i = 1; i <= ATTR_COUNT; i += 1) {
            var input = document.querySelector('input[name="attr' + i + '_' + sampleId + '"]');
            if (input) {
                inputs.push(input);
            }
        }
        return inputs;
    }

    function serializeRowAttributes(sampleId) {
        return getRowAttributeInputs(sampleId).map(function (input) {
            return input.value || '';
        }).join('\t');
    }

    function serializeSelectedRows(sampleIds) {
        return sampleIds.map(function (sampleId) {
            return serializeRowAttributes(sampleId);
        }).join('\n');
    }

    function serializeSelectedRowsByAttrs(sampleIds, attrNums) {
        var normalizedAttrs = normalizeAttrNums(attrNums);
        if (normalizedAttrs.length === ATTR_COUNT) {
            return serializeSelectedRows(sampleIds);
        }

        var headers = normalizedAttrs.map(function (attrNum) {
            return 'Attribute ' + attrNum;
        });
        var rows = sampleIds.map(function (sampleId) {
            return normalizedAttrs.map(function (attrNum) {
                var input = getInputBySampleAttr(sampleId, attrNum);
                return input ? (input.value || '') : '';
            }).join('\t');
        });
        return [headers.join('\t')].concat(rows).join('\n');
    }

    function flashInputs(inputs, className) {
        var targets = [];
        (inputs || []).forEach(function (input) {
            if (!input) {
                return;
            }
            var cell = input.closest('td');
            var target = cell || input;
            target.classList.remove(className);
            // Restart the animation when the same target is used again.
            void target.offsetWidth;
            target.classList.add(className);
            targets.push(target);
        });
        window.setTimeout(function () {
            targets.forEach(function (target) {
                target.classList.remove(className);
            });
        }, 900);
    }

    function flashOperationCells(sampleIds, attrNums, className) {
        var inputs = [];
        (sampleIds || []).forEach(function (sampleId) {
            normalizeAttrNums(attrNums).forEach(function (attrNum) {
                var input = getInputBySampleAttr(sampleId, attrNum);
                if (input) {
                    inputs.push(input);
                }
            });
        });
        flashInputs(inputs, className);
    }

    function markInputModified(input) {
        input.classList.add('paste-modified');
    }

    function validatePastedInputs(inputs) {
        if (typeof window.updateInputValidation !== 'function') {
            return;
        }
        inputs.forEach(function (input) {
            window.updateInputValidation(input);
        });
    }

    function pasteValuesIntoRow(sampleId, startAttr, values, options) {
        var opts = options || {};
        var maxWritable = ATTR_COUNT - startAttr + 1;
        var appliedCount = Math.min(values.length, maxWritable);
        var changedInputs = [];

        for (var i = 0; i < appliedCount; i += 1) {
            var attrNum = startAttr + i;
            var input = document.querySelector('input[name="attr' + attrNum + '_' + sampleId + '"]');
            if (!input) {
                continue;
            }

            var nextValue = values[i];
            if (input.value !== nextValue) {
                input.value = nextValue;
                markInputModified(input);
                changedInputs.push(input);
            }
        }

        validatePastedInputs(changedInputs);

        if (opts.refreshRow && typeof window.refreshRowLabelOptions === 'function') {
            window.refreshRowLabelOptions(sampleId);
        }

        if (values.length > maxWritable) {
            showClipboardToast(t('toastOverflowIgnored', 'Columns beyond Attribute 5 were ignored.'), 'warning');
        }

        return {
            changedInputs: changedInputs,
            appliedCount: appliedCount
        };
    }

    function getPageSampleIdsInOrder() {
        return Array.from(document.querySelectorAll('.sample-checkbox')).map(function (checkbox) {
            return String(checkbox.value);
        });
    }

    function getOrderedSelectedSampleIds() {
        var selectedSet = {};
        document.querySelectorAll('.sample-checkbox:checked').forEach(function (checkbox) {
            selectedSet[String(checkbox.value)] = true;
        });

        return getPageSampleIdsInOrder().filter(function (sampleId) {
            return !!selectedSet[sampleId];
        });
    }

    function getSelectedSampleIds() {
        return getOrderedSelectedSampleIds();
    }

    function hasDestructiveOverwrite(sampleIds, values) {
        var overwriteCount = 0;

        sampleIds.forEach(function (sampleId) {
            var rowWillOverwrite = false;
            for (var i = 0; i < values.length && i < ATTR_COUNT; i += 1) {
                var attrNum = i + 1;
                var input = document.querySelector('input[name="attr' + attrNum + '_' + sampleId + '"]');
                if (!input) {
                    continue;
                }

                var oldValue = input.value || '';
                var newValue = values[i];
                if (oldValue !== newValue && oldValue.trim() !== '') {
                    rowWillOverwrite = true;
                    break;
                }
            }

            if (rowWillOverwrite) {
                overwriteCount += 1;
            }
        });

        return overwriteCount;
    }

    function pasteValuesIntoSelectedRows(sampleIds, values) {
        var changedRowCount = 0;

        sampleIds.forEach(function (sampleId) {
            var result = pasteValuesIntoRow(sampleId, 1, values, { refreshRow: false });
            if (result.changedInputs.length > 0) {
                changedRowCount += 1;
                if (window.rowNarrowed && Object.prototype.hasOwnProperty.call(window.rowNarrowed, sampleId)) {
                    window.rowNarrowed[sampleId] = false;
                }
            }
        });

        return changedRowCount;
    }

    function isAttrInput(element) {
        return !!(element && element.classList && element.classList.contains('attr-input'));
    }

    function isOtherEditableTarget(element) {
        if (!element) {
            return false;
        }

        if (element.matches && element.matches('textarea, select, [contenteditable="true"]')) {
            return true;
        }

        if (element.isContentEditable) {
            return true;
        }

        if (element.tagName === 'INPUT') {
            var inputType = (element.type || 'text').toLowerCase();
            var blocked = {
                checkbox: true,
                radio: true,
                button: true,
                submit: true,
                reset: true,
                file: true,
                image: true,
                range: true,
                color: true,
                hidden: true
            };
            return !blocked[inputType];
        }

        return false;
    }

    function getInputBySampleAttr(sampleId, attrNum) {
        return document.querySelector('input[name="attr' + attrNum + '_' + sampleId + '"]');
    }

    function clearAttributeRangeSelection() {
        document.querySelectorAll('.attr-input.attr-range-selected, .attr-input.attr-range-start, .attr-input.attr-range-end').forEach(function (input) {
            input.classList.remove('attr-range-selected', 'attr-range-start', 'attr-range-end');
        });
        activeAttrRangeSelection = null;
    }

    function normalizeAttrNums(attrNums) {
        var seen = {};
        return (attrNums || []).map(function (attrNum) {
            return parseInt(attrNum, 10);
        }).filter(function (attrNum) {
            if (attrNum < 1 || attrNum > ATTR_COUNT || seen[attrNum]) {
                return false;
            }
            seen[attrNum] = true;
            return true;
        }).sort(function (left, right) {
            return left - right;
        });
    }

    function applyAttributeSelectionHighlight(sampleId, attrNums) {
        for (var attr = 1; attr <= ATTR_COUNT; attr += 1) {
            var input = getInputBySampleAttr(sampleId, attr);
            if (!input) {
                continue;
            }
            input.classList.remove('attr-range-selected', 'attr-range-start', 'attr-range-end');
        }

        var selectedAttrs = normalizeAttrNums(attrNums);
        selectedAttrs.forEach(function (selectedAttr) {
            var selectedInput = getInputBySampleAttr(sampleId, selectedAttr);
            if (selectedInput) {
                selectedInput.classList.add('attr-range-selected');
            }
        });

        var startInput = selectedAttrs.length > 0 ? getInputBySampleAttr(sampleId, selectedAttrs[0]) : null;
        var endInput = selectedAttrs.length > 0 ? getInputBySampleAttr(sampleId, selectedAttrs[selectedAttrs.length - 1]) : null;
        if (startInput) {
            startInput.classList.add('attr-range-start');
        }
        if (endInput) {
            endInput.classList.add('attr-range-end');
        }
    }

    function setAttributeSelection(sampleId, attrNums) {
        var normalized = normalizeAttrNums(attrNums);
        clearAttributeRangeSelection();
        if (normalized.length === 0) {
            return;
        }

        setRowSelectionAttrNums(normalized);

        activeAttrRangeSelection = {
            sampleId: String(sampleId),
            attrNums: normalized
        };
        applyAttributeSelectionHighlight(String(sampleId), normalized);
    }

    function setAttributeRangeSelection(sampleId, startAttr, endAttr) {
        var from = Math.min(startAttr, endAttr);
        var to = Math.max(startAttr, endAttr);
        var attrNums = [];
        for (var attr = from; attr <= to; attr += 1) {
            attrNums.push(attr);
        }
        setAttributeSelection(sampleId, attrNums);
    }

    function toggleAttributeSelection(sampleId, attrNum) {
        var rowSampleId = String(sampleId);
        var selectedAttrs = [];

        if (activeAttrRangeSelection && activeAttrRangeSelection.sampleId === rowSampleId) {
            selectedAttrs = activeAttrRangeSelection.attrNums.slice();
        }

        var selectedIndex = selectedAttrs.indexOf(attrNum);
        if (selectedIndex === -1) {
            selectedAttrs.push(attrNum);
        } else {
            selectedAttrs.splice(selectedIndex, 1);
        }

        setAttributeSelection(rowSampleId, selectedAttrs);
    }

    function setRowSelectionAttrNums(attrNums) {
        var normalized = normalizeAttrNums(attrNums);
        rowSelectionAttrNums = normalized.length > 0 ? normalized : [1, 2, 3, 4, 5];
    }

    function setRowSelectionAttrRange(startAttr, endAttr) {
        var start = parseInt(startAttr, 10);
        var end = parseInt(endAttr, 10);
        if (!start || !end) {
            setRowSelectionAttrNums([1, 2, 3, 4, 5]);
            return;
        }
        var attrNums = [];
        for (var attr = Math.max(1, Math.min(start, end)); attr <= Math.min(ATTR_COUNT, Math.max(start, end)); attr += 1) {
            attrNums.push(attr);
        }
        setRowSelectionAttrNums(attrNums);
    }

    function clearRowAttributeCellHighlight(row) {
        if (!row) {
            return;
        }
        row.querySelectorAll('td.clipboard-attr-selected, td.clipboard-attr-range-start, td.clipboard-attr-range-end').forEach(function (cell) {
            cell.classList.remove('clipboard-attr-selected', 'clipboard-attr-range-start', 'clipboard-attr-range-end');
        });
    }

    function getRowAttributeCell(row, attrNum) {
        if (!row) {
            return null;
        }
        var input = row.querySelector('.attr-input[data-attr="' + attrNum + '"]');
        return input && input.closest ? input.closest('td') : null;
    }

    function applyRowAttributeCellHighlight(row) {
        if (!row) {
            return;
        }

        clearRowAttributeCellHighlight(row);

        rowSelectionAttrNums.forEach(function (attr) {
            var cell = getRowAttributeCell(row, attr);
            if (cell) {
                cell.classList.add('clipboard-attr-selected');
            }
        });

        // Deliberately avoid drawing one continuous range: selections can be
        // non-contiguous (for example Attribute 2 and Attribute 4 only).
    }

    function serializeAttributeRangeSelection(selection) {
        if (!selection) {
            return '';
        }

        var sampleId = String(selection.sampleId || '');
        if (!sampleId) {
            return '';
        }

        var attrNums = normalizeAttrNums(selection.attrNums);
        if (attrNums.length === 0) {
            return '';
        }
        var values = [];
        attrNums.forEach(function (attr) {
            var input = getInputBySampleAttr(sampleId, attr);
            values.push(input ? (input.value || '') : '');
        });

        // Include explicit Attribute headers so later paste can restore exact column targets.
        var headers = attrNums.map(function (headerAttr) {
            return 'Attribute ' + headerAttr;
        });

        return headers.join('\t') + '\n' + values.join('\t');
    }

    function refreshModifiedState(input) {
        if (!input || !input.dataset) {
            return;
        }
        var sampleId = input.dataset.sampleId;
        var attrNum = input.dataset.attr;
        if (!sampleId || !attrNum) {
            return;
        }

        var origInput = document.querySelector('input[name="orig_attr' + attrNum + '_' + sampleId + '"]');
        var originalValue = origInput ? (origInput.value || '') : '';
        var currentValue = input.value || '';

        if (currentValue === originalValue) {
            input.classList.remove('paste-modified');
        } else {
            input.classList.add('paste-modified');
        }

        var reviewApi = window.LabelingPrelabelReview;
        if (reviewApi && typeof reviewApi.cancelAcceptanceForModifiedRow === 'function') {
            reviewApi.cancelAcceptanceForModifiedRow(input);
        }
    }

    function getInputEditKey(input) {
        if (!input || !input.dataset) {
            return '';
        }
        return String(input.dataset.sampleId || '') + ':' + String(input.dataset.attr || '');
    }

    function createManualEditTransaction(input, before, after) {
        return {
            operationType: 'manual-edit',
            createdAt: Date.now(),
            rows: 1,
            fields: 1,
            cells: [{
                sampleId: input.dataset.sampleId,
                attrNum: parseInt(input.dataset.attr, 10),
                before: before,
                after: after
            }]
        };
    }

    function parseClipboardEventMatrix(event) {
        var text = '';
        if (event.clipboardData) {
            text = event.clipboardData.getData('text/plain') || '';
        }
        return parseClipboardMatrix(text);
    }

    function buildPlanChanges(planRows) {
        var changedCells = [];
        var changedRowsSet = {};
        var overwriteRowsSet = {};
        var overwriteFields = 0;

        planRows.forEach(function (planRow) {
            Object.keys(planRow.attrValues).forEach(function (attrNumKey) {
                var attrNum = parseInt(attrNumKey, 10);
                var input = getInputBySampleAttr(planRow.sampleId, attrNum);
                if (!input) {
                    return;
                }

                var before = input.value || '';
                var after = planRow.attrValues[attrNum];
                if (typeof after === 'undefined') {
                    return;
                }

                if (before === after) {
                    return;
                }

                var isDestructive = before !== '';
                var isClearing = before !== '' && after === '';

                if (isDestructive) {
                    overwriteFields += 1;
                    overwriteRowsSet[planRow.sampleId] = true;
                }

                changedRowsSet[planRow.sampleId] = true;
                changedCells.push({
                    sampleId: planRow.sampleId,
                    attrNum: attrNum,
                    before: before,
                    after: after,
                    input: input,
                    isDestructive: isDestructive,
                    isClearing: isClearing
                });
            });
        });

        return {
            changedCells: changedCells,
            changedRowCount: Object.keys(changedRowsSet).length,
            overwriteRowCount: Object.keys(overwriteRowsSet).length,
            overwriteFieldCount: overwriteFields
        };
    }

    function createPlan(base) {
        var changes = buildPlanChanges(base.planRows);
        return {
            type: base.type,
            sourceRowCount: base.sourceRowCount,
            sourceColCount: base.sourceColCount,
            targetRowCount: base.targetRowCount,
            planRows: base.planRows,
            repeatTimes: base.repeatTimes || 1,
            requiresRepeatConfirm: !!base.requiresRepeatConfirm,
            headerUsed: !!base.headerUsed,
            changedCells: changes.changedCells,
            changedFieldCount: changes.changedCells.length,
            changedRowCount: changes.changedRowCount,
            overwriteRowCount: changes.overwriteRowCount,
            overwriteFieldCount: changes.overwriteFieldCount
        };
    }

    function buildFocusedPastePlan(parsed, activeInput) {
        if (!activeInput || !activeInput.dataset) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        if (parsed.sourceRowCount === 0) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        var mapping = detectHeaderMapping(parsed.matrix);
        if (mapping.error) {
            return {
                error: true,
                errorMessage: mapping.errorMessage
            };
        }

        var extracted = extractAttributeMatrix(parsed.matrix, mapping);
        if (extracted.sourceRowCount === 0) {
            return {
                error: true,
                errorMessage: t('toastSourceTargetMismatch', 'Source and target row counts do not match.')
            };
        }

        var sampleId = String(activeInput.dataset.sampleId || '');
        var startAttr = parseInt(activeInput.dataset.attr, 10);
        if (!sampleId || !startAttr) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        if (!mapping.hasHeader && extracted.sourceMaxColCount > ATTR_COUNT) {
            return {
                error: true,
                errorMessage: t('toastTooManyColumnsWithoutHeader', 'Clipboard has more than 5 columns without recognizable attribute headers. Please copy only Attribute 1-5 or include standard headers.')
            };
        }

        var pageSampleIds = getPageSampleIdsInOrder();
        var startIndex = pageSampleIds.indexOf(sampleId);
        if (startIndex === -1) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        var remainingRows = pageSampleIds.length - startIndex;
        if (extracted.sourceRowCount > remainingRows) {
            return {
                error: true,
                errorMessage: formatMessage(t('toastInsufficientRowsOnPage', 'Clipboard contains {rows} rows, but only {capacity} rows remain from the current position.'), {
                    rows: extracted.sourceRowCount,
                    capacity: remainingRows
                })
            };
        }

        var capacityCols = ATTR_COUNT - startAttr + 1;
        if (!mapping.hasHeader && extracted.sourceMaxColCount > capacityCols) {
            return {
                error: true,
                errorMessage: formatMessage(t('toastInsufficientAttrSpace', 'Starting from Attribute {start}, only {capacity} columns are available, but clipboard has {cols} columns.'), {
                    start: startAttr,
                    capacity: capacityCols,
                    cols: extracted.sourceMaxColCount
                })
            };
        }

        var targetSampleIds = pageSampleIds.slice(startIndex, startIndex + extracted.sourceRowCount);
        var planRows = [];

        for (var i = 0; i < extracted.rows.length; i += 1) {
            var sourceRow = extracted.rows[i];
            var targetSampleId = targetSampleIds[i];
            var attrValues = {};

            if (mapping.hasHeader) {
                sourceRow.providedAttrNums.forEach(function (attrNum) {
                    attrValues[attrNum] = sourceRow.attrValues[attrNum];
                });
            } else {
                sourceRow.providedAttrNums.forEach(function (sourceAttrNum) {
                    var targetAttrNum = startAttr + sourceAttrNum - 1;
                    attrValues[targetAttrNum] = sourceRow.attrValues[sourceAttrNum];
                });
            }

            planRows.push({
                sampleId: targetSampleId,
                attrValues: attrValues
            });
        }

        return createPlan({
            type: 'focused',
            sourceRowCount: extracted.sourceRowCount,
            sourceColCount: extracted.sourceMaxColCount,
            targetRowCount: extracted.sourceRowCount,
            planRows: planRows,
            headerUsed: mapping.hasHeader
        });
    }

    function buildSelectedRowsPastePlan(parsed, selectedSampleIds, startAttr, targetAttrNums) {
        var targetStartAttr = parseInt(startAttr, 10);
        var explicitTargetAttrs = normalizeAttrNums(targetAttrNums);
        if (!targetStartAttr || targetStartAttr < 1 || targetStartAttr > ATTR_COUNT) {
            targetStartAttr = 1;
        }

        if (!selectedSampleIds || selectedSampleIds.length === 0) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        if (parsed.sourceRowCount === 0) {
            return {
                error: true,
                errorMessage: t('toastNoTarget', 'Please click a target attribute, or select rows to paste.')
            };
        }

        var mapping = detectHeaderMapping(parsed.matrix);
        if (mapping.error) {
            return {
                error: true,
                errorMessage: mapping.errorMessage
            };
        }

        var extracted = extractAttributeMatrix(parsed.matrix, mapping);
        if (extracted.sourceRowCount === 0) {
            return {
                error: true,
                errorMessage: t('toastSourceTargetMismatch', 'Source and target row counts do not match.')
            };
        }

        if (!mapping.hasHeader && extracted.sourceMaxColCount > ATTR_COUNT) {
            return {
                error: true,
                errorMessage: t('toastTooManyColumnsWithoutHeader', 'Clipboard has more than 5 columns without recognizable attribute headers. Please copy only Attribute 1-5 or include standard headers.')
            };
        }

        // Plain 5-column payload is treated as full-row paste regardless of current focused column.
        if (!mapping.hasHeader && extracted.sourceMaxColCount === ATTR_COUNT) {
            targetStartAttr = 1;
            explicitTargetAttrs = [1, 2, 3, 4, 5];
        }

        if (!mapping.hasHeader) {
            var usesExplicitTarget = explicitTargetAttrs.length > 0 && explicitTargetAttrs.length < ATTR_COUNT;
            var capacityCols = usesExplicitTarget
                ? explicitTargetAttrs.length
                : ATTR_COUNT - targetStartAttr + 1;
            if (extracted.sourceMaxColCount > capacityCols) {
                return {
                    error: true,
                    errorMessage: formatMessage(t('toastInsufficientAttrSpace', 'Starting from Attribute {start}, only {capacity} columns are available, but clipboard has {cols} columns.'), {
                        start: targetStartAttr,
                        capacity: capacityCols,
                        cols: extracted.sourceMaxColCount
                    })
                };
            }
        }

        var sourceRows = extracted.rows;
        var sourceCount = sourceRows.length;
        var targetCount = selectedSampleIds.length;
        var sourceIndexes = [];
        var repeatTimes = 1;
        var requiresRepeatConfirm = false;

        if (sourceCount === 1) {
            for (var i = 0; i < targetCount; i += 1) {
                sourceIndexes.push(0);
            }
        } else if (sourceCount === targetCount) {
            for (var j = 0; j < targetCount; j += 1) {
                sourceIndexes.push(j);
            }
        } else if (targetCount > sourceCount && targetCount % sourceCount === 0) {
            requiresRepeatConfirm = true;
            repeatTimes = targetCount / sourceCount;
            for (var k = 0; k < targetCount; k += 1) {
                sourceIndexes.push(k % sourceCount);
            }
        } else {
            return {
                error: true,
                errorMessage: t('toastSourceTargetMismatch', 'Source and target row counts do not match.')
            };
        }

        var planRows = [];
        for (var rowIndex = 0; rowIndex < targetCount; rowIndex += 1) {
            var srcRow = sourceRows[sourceIndexes[rowIndex]];
            var attrValues = {};

            if (mapping.hasHeader) {
                srcRow.providedAttrNums.forEach(function (attrNum) {
                    attrValues[attrNum] = srcRow.attrValues[attrNum];
                });
            } else {
                srcRow.providedAttrNums.forEach(function (sourceAttrNum) {
                    var targetAttrNum = usesExplicitTarget
                        ? explicitTargetAttrs[sourceAttrNum - 1]
                        : targetStartAttr + sourceAttrNum - 1;
                    attrValues[targetAttrNum] = srcRow.attrValues[sourceAttrNum];
                });
            }

            planRows.push({
                sampleId: selectedSampleIds[rowIndex],
                attrValues: attrValues
            });
        }

        return createPlan({
            type: 'selected',
            sourceRowCount: sourceCount,
            sourceColCount: extracted.sourceMaxColCount,
            targetRowCount: targetCount,
            planRows: planRows,
            repeatTimes: repeatTimes,
            requiresRepeatConfirm: requiresRepeatConfirm,
            headerUsed: mapping.hasHeader
        });
    }

    function countDestructiveChanges(plan) {
        return {
            changedFields: plan.changedFieldCount,
            changedRows: plan.changedRowCount,
            overwriteRows: plan.overwriteRowCount,
            overwriteFields: plan.overwriteFieldCount,
            repeatTimes: plan.repeatTimes
        };
    }

    function confirmPastePlan(plan) {
        var stats = countDestructiveChanges(plan);
        var requiresOverwriteConfirm = stats.overwriteFields > 0;
        var requiresRepeatConfirm = plan.requiresRepeatConfirm;

        if (!requiresOverwriteConfirm && !requiresRepeatConfirm) {
            return true;
        }

        var message;
        if (requiresRepeatConfirm && requiresOverwriteConfirm) {
            message = formatMessage(
                t('confirmRepeatAndOverwriteTemplate', 'Repeated fill · {overwriteFields} existing labels will be replaced.'),
                {
                    sourceRows: plan.sourceRowCount,
                    times: plan.repeatTimes,
                    targetRows: plan.targetRowCount,
                    overwriteRows: stats.overwriteRows,
                    overwriteFields: stats.overwriteFields
                }
            );
        } else if (requiresRepeatConfirm) {
            message = formatMessage(
                t('confirmRepeatTemplate', 'The copied labels will repeat across {targetRows} rows.'),
                {
                    sourceRows: plan.sourceRowCount,
                    times: plan.repeatTimes,
                    targetRows: plan.targetRowCount
                }
            );
        } else {
            message = formatMessage(
                t('confirmOverwriteTemplate', '{overwriteFields} existing labels will be replaced.'),
                {
                    rows: plan.targetRowCount,
                    fields: stats.changedFields,
                    overwriteRows: stats.overwriteRows,
                    overwriteFields: stats.overwriteFields
                }
            );
        }

        showClipboardToast(message, 'warning');
        return true;
    }

    function createPasteTransaction(plan, rowHandledBefore) {
        return {
            operationType: 'clipboard-paste',
            createdAt: Date.now(),
            rows: plan.changedRowCount,
            fields: plan.changedFieldCount,
            rowHandledBefore: rowHandledBefore || {},
            cells: plan.changedCells.map(function (cell) {
                return {
                    sampleId: cell.sampleId,
                    attrNum: cell.attrNum,
                    before: cell.before,
                    after: cell.after
                };
            })
        };
    }

    function pushPasteTransaction(transaction) {
        undoStack.push(transaction);
        if (undoStack.length > MAX_UNDO_STACK) {
            undoStack.shift();
        }
    }

    function canUndoTransaction(transaction) {
        if (transaction && typeof transaction.canUndo === 'function') {
            return transaction.canUndo();
        }

        if (!transaction || !Array.isArray(transaction.cells) || transaction.cells.length === 0) {
            return false;
        }

        for (var i = 0; i < transaction.cells.length; i += 1) {
            var cell = transaction.cells[i];
            var input = getInputBySampleAttr(cell.sampleId, cell.attrNum);
            if (!input) {
                return false;
            }
            if ((input.value || '') !== cell.after) {
                return false;
            }
        }

        return true;
    }

    function applyPastePlan(plan) {
        if (!plan || !Array.isArray(plan.planRows) || plan.planRows.length === 0) {
            return false;
        }

        var affectedInputs = [];
        var affectedRows = {};
        var rowHandledBefore = {};
        var targetInputs = [];

        plan.planRows.forEach(function (planRow) {
            affectedRows[planRow.sampleId] = true;
            var targetRow = document.querySelector('tr[data-sample-id="' + planRow.sampleId + '"]');
            rowHandledBefore[planRow.sampleId] = !!(
                targetRow && targetRow.dataset.clipboardPasteHandled === '1'
            );
            Object.keys(planRow.attrValues).forEach(function (attrNumKey) {
                var targetInput = getInputBySampleAttr(planRow.sampleId, parseInt(attrNumKey, 10));
                if (targetInput) {
                    targetInputs.push(targetInput);
                }
            });
        });

        isApplyingClipboardOperation = true;
        try {
            plan.changedCells.forEach(function (cell) {
                cell.input.value = cell.after;
                markInputModified(cell.input);
                affectedInputs.push(cell.input);
                affectedRows[cell.sampleId] = true;
            });
        } finally {
            isApplyingClipboardOperation = false;
        }

        validatePastedInputs(affectedInputs);
        affectedInputs.forEach(function (input) {
            refreshModifiedState(input);
        });
        flashInputs(targetInputs, 'clipboard-paste-flash');

        Object.keys(affectedRows).forEach(function (sampleId) {
            var row = document.querySelector('tr[data-sample-id="' + sampleId + '"]');
            if (row) {
                row.dataset.clipboardPasteHandled = '1';
            }
            if (window.rowNarrowed && Object.prototype.hasOwnProperty.call(window.rowNarrowed, sampleId)) {
                window.rowNarrowed[sampleId] = false;
            }
        });

        if (typeof window.refreshLabelingRowProgress === 'function') {
            window.refreshLabelingRowProgress();
        }

        lastOperationType = 'clipboard-paste';

        if (plan.changedFieldCount > 0) {
            pushPasteTransaction(createPasteTransaction(plan, rowHandledBefore));
            var pastedMsg = formatMessage(t('toastPastedRowsAndFields', 'Pasted into {rows} rows · {fields} labels updated.'), {
                rows: plan.targetRowCount,
                fields: plan.changedFieldCount
            });
            showClipboardToast(pastedMsg);
        } else {
            showClipboardToast(t('toastNoValueChanged', 'Labels unchanged · marked as handled.'));
        }

        // Keep behavior aligned with row selection workflow: clear any active attr-range selection after paste.
        clearAttributeRangeSelection();

        return true;
    }

    function executePastePlan(plan) {
        if (plan.error) {
            showClipboardToast(plan.errorMessage, 'warning');
            return;
        }

        if (!confirmPastePlan(plan)) {
            return;
        }

        var applied = applyPastePlan(plan);
        if (!applied) {
            return;
        }

        if (plan.type === 'selected') {
            clearSelectedRows();
        }
    }

    function undoLastPaste() {
        if (undoStack.length === 0) {
            showClipboardToast(t('toastNoUndo', 'No paste operation can be undone.'), 'warning');
            return false;
        }

        var transaction = undoStack[undoStack.length - 1];
        if (!canUndoTransaction(transaction)) {
            showClipboardToast(t('toastUndoUnsafe', 'Some pasted values were modified again, so this paste cannot be safely undone.'), 'warning');
            return false;
        }

        undoStack.pop();

        if (typeof transaction.applyUndo === 'function') {
            var applied = transaction.applyUndo();
            if (!applied) {
                undoStack.push(transaction);
                showClipboardToast(t('toastUndoUnsafe', 'The value changed again, so this action cannot be safely undone.'), 'warning');
                return false;
            }

            lastOperationType = undoStack.length > 0
                ? (undoStack[undoStack.length - 1].operationType || 'clipboard-paste')
                : 'clipboard-undo';
            showClipboardToast(transaction.undoMessage || t('toastUndoSuccessGeneric', 'Last action undone.'));
            return true;
        }

        var affectedInputs = [];
        var affectedRows = {};

        isApplyingClipboardOperation = true;
        try {
            transaction.cells.forEach(function (cell) {
                var input = getInputBySampleAttr(cell.sampleId, cell.attrNum);
                if (!input) {
                    return;
                }
                input.value = cell.before;
                affectedInputs.push(input);
                affectedRows[cell.sampleId] = true;
            });
        } finally {
            isApplyingClipboardOperation = false;
        }

        validatePastedInputs(affectedInputs);
        affectedInputs.forEach(function (input) {
            refreshModifiedState(input);
        });

        Object.keys(affectedRows).forEach(function (sampleId) {
            if (window.rowNarrowed && Object.prototype.hasOwnProperty.call(window.rowNarrowed, sampleId)) {
                window.rowNarrowed[sampleId] = false;
            }
            if (transaction.rowHandledBefore) {
                var row = document.querySelector('tr[data-sample-id="' + sampleId + '"]');
                if (row) {
                    if (transaction.rowHandledBefore[sampleId]) {
                        row.dataset.clipboardPasteHandled = '1';
                    } else {
                        delete row.dataset.clipboardPasteHandled;
                    }
                }
            }
        });

        if (typeof window.refreshLabelingRowProgress === 'function') {
            window.refreshLabelingRowProgress();
        }

        if (undoStack.length > 0) {
            lastOperationType = undoStack[undoStack.length - 1].operationType || 'clipboard-paste';
        } else {
            lastOperationType = 'clipboard-undo';
        }
        showClipboardToast(formatMessage(t('toastUndoSuccess', 'Paste undone · restored {rows} rows and {fields} labels.'), {
            rows: transaction.rows,
            fields: transaction.fields
        }));
        return true;
    }

    function collectClearCells(sampleIds, attrNums) {
        var changedCells = [];
        (sampleIds || []).forEach(function (sampleId) {
            normalizeAttrNums(attrNums).forEach(function (attrNum) {
                var input = getInputBySampleAttr(sampleId, attrNum);
                var before = input ? (input.value || '') : '';
                if (!input || before === '') {
                    return;
                }
                changedCells.push({
                    sampleId: String(sampleId),
                    attrNum: attrNum,
                    before: before,
                    after: '',
                    input: input
                });
            });
        });
        return changedCells;
    }

    function showClearConfirmation(rowCount, fieldCount, onConfirm) {
        var modalElement = document.getElementById('clipboardClearConfirmModal');
        if (!modalElement || !window.bootstrap || !window.bootstrap.Modal) {
            if (window.confirm(formatMessage(t('confirmClearTemplate', 'Clear {fields} labels from {rows} selected rows?'), {
                rows: rowCount,
                fields: fieldCount
            }))) {
                onConfirm();
            }
            return;
        }

        var summary = modalElement.querySelector('[data-clear-confirm-summary]');
        var confirmButton = modalElement.querySelector('[data-clear-confirm-action]');
        if (summary) {
            summary.textContent = formatMessage(t('confirmClearTemplate', 'Clear {fields} labels from {rows} selected rows?'), {
                rows: rowCount,
                fields: fieldCount
            });
        }

        var modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);
        var handleConfirm = function () {
            confirmButton.removeEventListener('click', handleConfirm);
            modal.hide();
            onConfirm();
        };
        confirmButton.addEventListener('click', handleConfirm, { once: true });
        modalElement.addEventListener('hidden.bs.modal', function cleanup() {
            confirmButton.removeEventListener('click', handleConfirm);
            modalElement.removeEventListener('hidden.bs.modal', cleanup);
        });
        modal.show();
    }

    function applyClearCells(changedCells) {
        var affectedRows = {};

        if (changedCells.length === 0) {
            showClipboardToast(t('toastRowAlreadyEmpty', 'This row has no labels to clear.'), 'warning');
            return false;
        }

        isApplyingClipboardOperation = true;
        try {
            changedCells.forEach(function (cell) {
                cell.input.value = '';
            });
        } finally {
            isApplyingClipboardOperation = false;
        }

        var affectedInputs = changedCells.map(function (cell) {
            affectedRows[cell.sampleId] = true;
            return cell.input;
        });
        validatePastedInputs(affectedInputs);
        affectedInputs.forEach(refreshModifiedState);

        Object.keys(affectedRows).forEach(function (sampleId) {
            if (window.rowNarrowed && Object.prototype.hasOwnProperty.call(window.rowNarrowed, sampleId)) {
                window.rowNarrowed[sampleId] = false;
            }
        });

        pushPasteTransaction({
            operationType: 'row-clear',
            createdAt: Date.now(),
            rows: Object.keys(affectedRows).length,
            fields: changedCells.length,
            cells: changedCells.map(function (cell) {
                return {
                    sampleId: cell.sampleId,
                    attrNum: cell.attrNum,
                    before: cell.before,
                    after: cell.after
                };
            })
        });
        lastOperationType = 'row-clear';
        clearAttributeRangeSelection();
        showClipboardToast(formatMessage(t('toastRowsCleared', 'Cleared {fields} labels from {rows} rows. Press Ctrl+Z to undo.'), {
            rows: Object.keys(affectedRows).length,
            fields: changedCells.length
        }));
        return true;
    }

    function clearTargetAttributes(sampleIds, attrNums, requireConfirmation) {
        var targets = (sampleIds || []).map(String).filter(Boolean);
        var changedCells = collectClearCells(targets, attrNums);
        if (changedCells.length === 0) {
            showClipboardToast(t('toastRowAlreadyEmpty', 'This selection has no labels to clear.'), 'warning');
            return false;
        }

        var apply = function () {
            applyClearCells(changedCells);
            if (targets.length > 1) {
                clearSelectedRows();
            }
        };
        if (requireConfirmation && targets.length > 1) {
            showClearConfirmation(targets.length, changedCells.length, apply);
            return true;
        }
        apply();
        return true;
    }

    function clearRowAttributes(sampleId) {
        return clearTargetAttributes([sampleId], [1, 2, 3, 4, 5], false);
    }

    function clearSelectionOrRowAttributes(fallbackSampleId) {
        var selectedSampleIds = getSelectedSampleIds();
        if (selectedSampleIds.length > 0) {
            return clearTargetAttributes(selectedSampleIds, rowSelectionAttrNums, true);
        }
        if (activeAttrRangeSelection) {
            return clearTargetAttributes(
                [activeAttrRangeSelection.sampleId],
                activeAttrRangeSelection.attrNums,
                false
            );
        }
        return clearTargetAttributes([fallbackSampleId], [1, 2, 3, 4, 5], false);
    }

    function handleUndoShortcut(event) {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey || event.altKey) {
            return;
        }

        if (undoStack.length === 0) {
            return;
        }

        var activeElement = document.activeElement;
        if (isOtherEditableTarget(activeElement) && !isAttrInput(activeElement)) {
            return;
        }

        event.preventDefault();
        undoLastPaste();
    }

    function getLatestUndoTimestamp() {
        if (undoStack.length === 0) {
            return 0;
        }
        return Number(undoStack[undoStack.length - 1].createdAt) || 0;
    }

    function handleClearSelectionShortcut(event) {
        if (event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        // Keep Bootstrap modal Escape behavior (close modal) untouched.
        if (document.querySelector('.modal.show')) {
            return;
        }

        var hasAttrRangeSelection = !!activeAttrRangeSelection;
        var selectedCount = document.querySelectorAll('.sample-checkbox:checked').length;
        if (!hasAttrRangeSelection && selectedCount === 0) {
            return;
        }

        event.preventDefault();
        clearAttributeRangeSelection();
        if (selectedCount > 0) {
            clearSelectedRows();
        }
    }

    function getSampleCheckboxes() {
        return Array.from(document.querySelectorAll('.sample-checkbox'));
    }

    function getSamplesTableBody() {
        return document.getElementById('samplesTableBody') || document.querySelector('#samplesTable tbody');
    }

    function getRowCheckbox(row) {
        if (!row) {
            return null;
        }
        return row.querySelector('.sample-checkbox');
    }

    function getSampleRowFromElement(element) {
        if (!element || !element.closest) {
            return null;
        }
        var row = element.closest('tr');
        if (!row) {
            return null;
        }
        return getRowCheckbox(row) ? row : null;
    }

    function getCheckboxFromElement(element) {
        var row = getSampleRowFromElement(element);
        return getRowCheckbox(row);
    }

    function focusSelectionCheckbox(checkbox) {
        if (!checkbox || typeof checkbox.focus !== 'function') {
            return;
        }
        checkbox.focus({ preventScroll: true });
    }

    function syncSelectionUI() {
        var checkboxes = getSampleCheckboxes();
        var selectedCount = 0;

        checkboxes.forEach(function (checkbox, index) {
            var row = checkbox.closest('tr');
            if (!row) {
                return;
            }

            clearRowAttributeCellHighlight(row);

            if (checkbox.checked) {
                selectedCount += 1;
                row.classList.add('clipboard-range-selected');
                applyRowAttributeCellHighlight(row);
            } else {
                row.classList.remove('clipboard-range-selected');
            }

            if (rangeAnchorIndex === index) {
                row.classList.add('clipboard-anchor-row');
            } else {
                row.classList.remove('clipboard-anchor-row');
            }
        });

        var selectedCountBadge = document.getElementById('selectedCount');
        if (selectedCountBadge) {
            selectedCountBadge.textContent = String(selectedCount);
        }

        var batchActionsCard = document.getElementById('batchActionsCard');
        if (batchActionsCard) {
            batchActionsCard.classList.toggle('d-none', selectedCount === 0);
            document.body.classList.toggle('has-clipboard-selection', selectedCount > 0);
            var selectedAttrs = normalizeAttrNums(rowSelectionAttrNums);
            var attrSummary = document.getElementById('selectedAttrSummary');
            var cellCount = document.getElementById('selectedCellCount');
            if (attrSummary) {
                attrSummary.textContent = selectedAttrs.join(', ');
            }
            if (cellCount) {
                cellCount.textContent = String(selectedCount * selectedAttrs.length);
            }
        }

        var selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
            selectAllCheckbox.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
        }
    }

    function clearSelectedRows() {
        getSampleCheckboxes().forEach(function (checkbox) {
            checkbox.checked = false;
        });
        rangeAnchorIndex = null;
        syncSelectionUI();
    }

    function getCheckboxIndex(checkbox) {
        var checkboxes = getSampleCheckboxes();
        return checkboxes.indexOf(checkbox);
    }

    function selectCheckboxRange(startIndex, endIndex, checked) {
        var checkboxes = getSampleCheckboxes();
        var from = Math.min(startIndex, endIndex);
        var to = Math.max(startIndex, endIndex);

        for (var i = from; i <= to; i += 1) {
            checkboxes[i].checked = checked;
        }
        syncSelectionUI();
    }

    function handleCheckboxClick(event, checkbox) {
        var currentIndex = getCheckboxIndex(checkbox);
        if (currentIndex === -1) {
            return;
        }

        clearAttributeRangeSelection();
        setRowSelectionAttrNums(copiedAttrNums);

        if (event.shiftKey && event.ctrlKey) {
            event.preventDefault();
            if (rangeAnchorIndex === null) {
                checkbox.checked = true;
                rangeAnchorIndex = currentIndex;
                syncSelectionUI();
                focusSelectionCheckbox(checkbox);
                return;
            }

            selectCheckboxRange(rangeAnchorIndex, currentIndex, true);
            focusSelectionCheckbox(checkbox);
            return;
        }

        if (event.shiftKey) {
            if (rangeAnchorIndex === null) {
                rangeAnchorIndex = currentIndex;
                syncSelectionUI();
                return;
            }

            selectCheckboxRange(rangeAnchorIndex, currentIndex, checkbox.checked);
            focusSelectionCheckbox(checkbox);
            return;
        }

        rangeAnchorIndex = currentIndex;
        syncSelectionUI();
    }

    function shouldIgnoreRowShortcutTarget(target) {
        if (!target) {
            return true;
        }

        if (target.closest('.modal, .multiselect-container')) {
            return true;
        }

        var inputEl = target.closest('input');
        if (inputEl && inputEl.classList.contains('sample-checkbox')) {
            return true;
        }

        // Ctrl is an explicit selection gesture inside the data table:
        // attribute cells select labels; every other cell selects the whole row.
        return !getSampleRowFromElement(target);
    }

    function applyCtrlShiftRangeSelection(targetCheckbox) {
        var targetIndex = getCheckboxIndex(targetCheckbox);
        if (targetIndex === -1) {
            return;
        }

        clearAttributeRangeSelection();
        setRowSelectionAttrNums(copiedAttrNums);

        if (rangeAnchorIndex === null) {
            targetCheckbox.checked = true;
            rangeAnchorIndex = targetIndex;
            syncSelectionUI();
            focusSelectionCheckbox(targetCheckbox);
            return;
        }

        selectCheckboxRange(rangeAnchorIndex, targetIndex, true);
        focusSelectionCheckbox(targetCheckbox);
    }

    function applyCtrlSingleRowToggle(checkbox) {
        var currentIndex = getCheckboxIndex(checkbox);
        if (currentIndex === -1) {
            return;
        }

        clearAttributeRangeSelection();
        setRowSelectionAttrNums(copiedAttrNums);

        checkbox.checked = !checkbox.checked;
        rangeAnchorIndex = currentIndex;
        syncSelectionUI();
        focusSelectionCheckbox(checkbox);
    }

    function getAttrInputFromElement(element) {
        if (!element || !element.closest) {
            return null;
        }
        var input = element.closest('.attr-input');
        if (!input) {
            var cell = element.closest('td');
            if (cell) {
                input = cell.querySelector('.attr-input');
            }
        }
        return input && isAttrInput(input) ? input : null;
    }

    function getAttrNumFromInput(input) {
        if (!input || !input.dataset) {
            return null;
        }
        var attrNum = parseInt(input.dataset.attr, 10);
        return Number.isFinite(attrNum) ? attrNum : null;
    }

    function setDragCursorMode(mode) {
        document.body.classList.remove('clipboard-drag-mode-row', 'clipboard-drag-mode-col');
        document.body.classList.add('clipboard-dragging');
        if (mode === 'vertical') {
            document.body.classList.add('clipboard-drag-mode-row');
        } else if (mode === 'horizontal') {
            document.body.classList.add('clipboard-drag-mode-col');
        }
    }

    function clearDragCursorMode() {
        document.body.classList.remove('clipboard-dragging', 'clipboard-drag-mode-row', 'clipboard-drag-mode-col');
    }

    function stopDragAutoScroll() {
        if (dragAutoScrollFrame !== null) {
            window.cancelAnimationFrame(dragAutoScrollFrame);
            dragAutoScrollFrame = null;
        }
    }

    function clearCtrlDragState() {
        stopDragAutoScroll();
        ctrlDragState = null;
        clearDragCursorMode();
    }

    function applyVerticalPaintOnCheckbox(state, checkbox) {
        if (!state || !checkbox) {
            return;
        }

        var index = getCheckboxIndex(checkbox);
        if (index === -1 || state.visitedIndexes[index]) {
            return;
        }

        state.visitedIndexes[index] = true;
        checkbox.checked = state.paintTargetChecked;
        state.lastPaintedCheckbox = checkbox;
        syncSelectionUI();
    }

    function updateDragModeAndSelection(state, event) {
        if (!state) {
            return;
        }

        var deltaX = event.clientX - state.startX;
        var deltaY = event.clientY - state.startY;
        var absX = Math.abs(deltaX);
        var absY = Math.abs(deltaY);

        if (!state.exceededThreshold && Math.max(absX, absY) >= DRAG_THRESHOLD_PX) {
            state.exceededThreshold = true;
            setDragCursorMode(null);
        }

        if (!state.exceededThreshold) {
            return;
        }

        if (state.mode === 'pending') {
            if (absY > DIRECTION_RATIO * absX) {
                state.mode = 'vertical';
                clearAttributeRangeSelection();
                setRowSelectionAttrNums(copiedAttrNums);
                state.paintTargetChecked = !state.startChecked;
                state.visitedIndexes = {};
                setDragCursorMode('vertical');
                applyVerticalPaintOnCheckbox(state, state.startCheckbox);
            } else if (absX > DIRECTION_RATIO * absY && state.startAttrInput) {
                var firstHoverElement = document.elementFromPoint(event.clientX, event.clientY);
                var firstHoverAttr = getAttrInputFromElement(firstHoverElement);
                var firstHoverCheckbox = getCheckboxFromElement(firstHoverElement);
                var firstHoverAttrNum = getAttrNumFromInput(firstHoverAttr);

                // Horizontal attribute mode is only valid within the same row and must cross to another attribute.
                if (
                    firstHoverAttr &&
                    firstHoverCheckbox &&
                    firstHoverCheckbox === state.startCheckbox &&
                    firstHoverAttrNum &&
                    firstHoverAttrNum !== state.startAttrNum
                ) {
                    state.mode = 'horizontal';
                    clearSelectedRows();
                    setDragCursorMode('horizontal');
                    setAttributeRangeSelection(state.startSampleId, state.startAttrNum, firstHoverAttrNum);
                }
            }
        }

        if (state.mode === 'vertical') {
            var verticalElement = document.elementFromPoint(event.clientX, event.clientY);
            var verticalCheckbox = getCheckboxFromElement(verticalElement);
            if (verticalCheckbox) {
                applyVerticalPaintOnCheckbox(state, verticalCheckbox);
                event.preventDefault();
            }
            return;
        }

        if (state.mode === 'horizontal') {
            var horizontalElement = document.elementFromPoint(event.clientX, event.clientY);
            var horizontalAttrInput = getAttrInputFromElement(horizontalElement);
            var horizontalCheckbox = getCheckboxFromElement(horizontalElement);
            var horizontalAttrNum = getAttrNumFromInput(horizontalAttrInput);

            if (
                horizontalAttrInput &&
                horizontalCheckbox &&
                horizontalCheckbox === state.startCheckbox &&
                horizontalAttrNum
            ) {
                setAttributeRangeSelection(state.startSampleId, state.startAttrNum, horizontalAttrNum);
                event.preventDefault();
            }
        }
    }

    function getDragAutoScrollSpeed(clientY) {
        if (clientY < AUTO_SCROLL_EDGE_PX) {
            return -Math.ceil(AUTO_SCROLL_MAX_PX * Math.min(1, (AUTO_SCROLL_EDGE_PX - clientY) / AUTO_SCROLL_EDGE_PX));
        }

        var lowerEdge = window.innerHeight - AUTO_SCROLL_EDGE_PX;
        if (clientY > lowerEdge) {
            return Math.ceil(AUTO_SCROLL_MAX_PX * Math.min(1, (clientY - lowerEdge) / AUTO_SCROLL_EDGE_PX));
        }

        return 0;
    }

    function runDragAutoScroll() {
        dragAutoScrollFrame = null;

        var state = ctrlDragState;
        if (!state || !state.exceededThreshold || state.mode === 'horizontal') {
            return;
        }

        var speed = getDragAutoScrollSpeed(state.lastClientY);
        if (speed === 0) {
            return;
        }

        var previousScrollY = window.scrollY;
        window.scrollBy(0, speed);

        if (window.scrollY !== previousScrollY) {
            updateDragModeAndSelection(state, {
                clientX: state.lastClientX,
                clientY: state.lastClientY,
                preventDefault: function () {}
            });
        }

        dragAutoScrollFrame = window.requestAnimationFrame(runDragAutoScroll);
    }

    function updateDragAutoScroll(state, event) {
        state.lastClientX = event.clientX;
        state.lastClientY = event.clientY;

        if (!state.exceededThreshold || state.mode === 'horizontal') {
            stopDragAutoScroll();
            return;
        }

        if (dragAutoScrollFrame === null) {
            dragAutoScrollFrame = window.requestAnimationFrame(runDragAutoScroll);
        }
    }

    function finishCtrlDragSelection() {
        if (!ctrlDragState) {
            return;
        }

        var state = ctrlDragState;
        var shouldSuppress = false;

        if (state.captureElement && state.captureElement.releasePointerCapture) {
            try {
                state.captureElement.releasePointerCapture(state.pointerId);
            } catch (e) {
                // Ignore release failures for non-captured pointers.
            }
        }

        if (state.mode === 'vertical') {
            syncSelectionUI();
            focusSelectionCheckbox(state.lastPaintedCheckbox || state.startCheckbox);
            shouldSuppress = true;
        } else if (state.mode === 'horizontal') {
            shouldSuppress = true;
        } else if (state.startAttrInput && state.startAttrNum) {
            clearSelectedRows();
            toggleAttributeSelection(state.startSampleId, state.startAttrNum);
            state.startAttrInput.focus({ preventScroll: true });
            if (typeof state.startAttrInput.setSelectionRange === 'function') {
                var valueLength = (state.startAttrInput.value || '').length;
                state.startAttrInput.setSelectionRange(valueLength, valueLength);
            }
            shouldSuppress = true;
        } else if (state.startCheckbox) {
            applyCtrlSingleRowToggle(state.startCheckbox);
            shouldSuppress = true;
        }

        clearCtrlDragState();
        suppressNextClick = shouldSuppress;
    }

    function forceFinishCtrlDragSelection() {
        if (!ctrlDragState) {
            return;
        }

        if (ctrlDragState.mode === 'vertical') {
            syncSelectionUI();
            focusSelectionCheckbox(ctrlDragState.lastPaintedCheckbox || ctrlDragState.startCheckbox);
            suppressNextClick = true;
        }

        clearCtrlDragState();
    }

    function bindShiftRangeSelection() {
        var sampleCheckboxes = getSampleCheckboxes();
        var selectAllCheckbox = document.getElementById('selectAllCheckbox');
        var tableBody = getSamplesTableBody();

        sampleCheckboxes.forEach(function (checkbox) {
            checkbox.addEventListener('click', function (event) {
                handleCheckboxClick(event, this);
            });
            checkbox.addEventListener('change', function () {
                syncSelectionUI();
            });
        });

        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', function () {
                clearAttributeRangeSelection();
                setRowSelectionAttrNums(copiedAttrNums);
                getSampleCheckboxes().forEach(function (checkbox) {
                    checkbox.checked = !!selectAllCheckbox.checked;
                });
                rangeAnchorIndex = null;
                syncSelectionUI();
            });
        }

        if (tableBody) {
            tableBody.addEventListener('pointerdown', function (event) {
                if (event.button !== 0 || !event.ctrlKey || event.shiftKey) {
                    return;
                }

                if (shouldIgnoreRowShortcutTarget(event.target)) {
                    return;
                }

                var checkbox = getCheckboxFromElement(event.target);
                if (!checkbox) {
                    return;
                }

                var startIndex = getCheckboxIndex(checkbox);
                if (startIndex === -1) {
                    return;
                }

                var startAttrInput = getAttrInputFromElement(event.target);
                var startAttrNum = getAttrNumFromInput(startAttrInput);

                ctrlDragState = {
                    pointerId: event.pointerId,
                    captureElement: tableBody,
                    startX: event.clientX,
                    startY: event.clientY,
                    lastClientX: event.clientX,
                    lastClientY: event.clientY,
                    exceededThreshold: false,
                    mode: 'pending',
                    startCheckbox: checkbox,
                    startSampleId: String(checkbox.value),
                    startChecked: !!checkbox.checked,
                    startAttrInput: startAttrInput,
                    startAttrNum: startAttrNum,
                    paintTargetChecked: !checkbox.checked,
                    visitedIndexes: {},
                    lastPaintedCheckbox: checkbox
                };
                rangeAnchorIndex = startIndex;

                event.preventDefault();

                if (tableBody.setPointerCapture) {
                    try {
                        tableBody.setPointerCapture(event.pointerId);
                    } catch (e) {
                        // Ignore pointer capture errors and continue without capture.
                    }
                }
            });

            tableBody.addEventListener('pointermove', function (event) {
                if (!ctrlDragState || event.pointerId !== ctrlDragState.pointerId) {
                    return;
                }
                updateDragModeAndSelection(ctrlDragState, event);
                updateDragAutoScroll(ctrlDragState, event);
            });

            tableBody.addEventListener('click', function (event) {
                if (suppressNextClick) {
                    event.preventDefault();
                    event.stopPropagation();
                    suppressNextClick = false;
                    return;
                }

                if (!(event.ctrlKey && event.shiftKey)) {
                    return;
                }

                if (shouldIgnoreRowShortcutTarget(event.target)) {
                    return;
                }

                var checkbox = getCheckboxFromElement(event.target);
                if (!checkbox) {
                    return;
                }

                event.preventDefault();
                applyCtrlShiftRangeSelection(checkbox);
            });
        }

        document.addEventListener('pointerup', function (event) {
            if (!ctrlDragState || event.pointerId !== ctrlDragState.pointerId) {
                return;
            }
            finishCtrlDragSelection();
        });

        document.addEventListener('pointercancel', function (event) {
            if (!ctrlDragState || event.pointerId !== ctrlDragState.pointerId) {
                return;
            }
            finishCtrlDragSelection();
        });

        window.addEventListener('blur', forceFinishCtrlDragSelection);
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                forceFinishCtrlDragSelection();
            }
        });

        syncSelectionUI();
    }

    function bindCtrlWheelZoomGuard() {
        var samplesTable = document.getElementById('samplesTable');
        if (!samplesTable) {
            return;
        }

        samplesTable.addEventListener('wheel', function (event) {
            // Browsers treat Ctrl/Cmd + wheel as page zoom. In the sample table,
            // prefer stable row-selection interaction and suppress zoom.
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
            }
        }, { passive: false });
    }

    function handleCopy(event) {
        var activeElement = document.activeElement;

        if (isAttrInput(activeElement)) {
            if (typeof activeElement.selectionStart === 'number' && typeof activeElement.selectionEnd === 'number') {
                if (activeElement.selectionStart !== activeElement.selectionEnd) {
                    return;
                }
            }
        }

        if (activeAttrRangeSelection) {
            var serializedAttrRange = serializeAttributeRangeSelection(activeAttrRangeSelection);
            if (serializedAttrRange && event.clipboardData) {
                var copiedSampleId = activeAttrRangeSelection.sampleId;
                var selectedAttrNums = activeAttrRangeSelection.attrNums.slice();
                event.preventDefault();
                event.clipboardData.setData('text/plain', serializedAttrRange);
                copiedAttrNums = selectedAttrNums.slice();
                setRowSelectionAttrNums(copiedAttrNums);
                clearAttributeRangeSelection();
                clearSelectedRows();
                flashOperationCells([copiedSampleId], copiedAttrNums, 'clipboard-copy-flash');
                showClipboardToast(t('toastCopiedAttrRange', 'Selected labels copied.'));
            }
            return;
        }

        if (!isAttrInput(activeElement) && isOtherEditableTarget(activeElement)) {
            return;
        }

        var selectedSampleIds = getSelectedSampleIds();
        if (selectedSampleIds.length > 0) {
            var selectedAttrs = normalizeAttrNums(rowSelectionAttrNums);
            var serialized = serializeSelectedRowsByAttrs(selectedSampleIds, selectedAttrs);
            if (event.clipboardData) {
                event.preventDefault();
                event.clipboardData.setData('text/plain', serialized);
                copiedAttrNums = selectedAttrs.slice();
                setRowSelectionAttrNums(copiedAttrNums);
                flashOperationCells(selectedSampleIds, copiedAttrNums, 'clipboard-copy-flash');
                clearAttributeRangeSelection();
                clearSelectedRows();
                showClipboardToast(formatMessage(t('toastCopiedRows', 'Copied labels from {rows} rows.'), {
                    rows: selectedSampleIds.length
                }));
            }
            return;
        }

        if (isAttrInput(activeElement)) {
            var sampleId = activeElement.dataset.sampleId;
            if (!sampleId) {
                return;
            }

            var serializedRow = serializeRowAttributes(sampleId);
            if (event.clipboardData) {
                event.preventDefault();
                event.clipboardData.setData('text/plain', serializedRow);
                copiedAttrNums = [1, 2, 3, 4, 5];
                setRowSelectionAttrRange(1, ATTR_COUNT);
                clearAttributeRangeSelection();
                clearSelectedRows();
                flashOperationCells([sampleId], copiedAttrNums, 'clipboard-copy-flash');
                showClipboardToast(t('toastCopiedRow', 'Copied labels from the current row.'));
            }
            return;
        }

        var activeRow = document.querySelector('tr[data-sample-id].labeling-row-active');
        if (activeRow && activeRow.dataset.sampleId && event.clipboardData) {
            var activeSampleId = activeRow.dataset.sampleId;
            event.preventDefault();
            event.clipboardData.setData('text/plain', serializeRowAttributes(activeSampleId));
            copiedAttrNums = [1, 2, 3, 4, 5];
            setRowSelectionAttrNums(copiedAttrNums);
            flashOperationCells([activeSampleId], copiedAttrNums, 'clipboard-copy-flash');
            showClipboardToast(t('toastCopiedRow', 'Copied labels from the current row.'));
        }
    }

    function handlePaste(event) {
        var activeElement = document.activeElement;
        var selectedSampleIds = getSelectedSampleIds();

        if (selectedSampleIds.length > 0) {
            var parsedSelected = parseClipboardEventMatrix(event);
            var startAttr = isAttrInput(activeElement) ? parseInt(activeElement.dataset.attr, 10) : 1;
            event.preventDefault();
            var selectedPlan = buildSelectedRowsPastePlan(
                parsedSelected,
                selectedSampleIds,
                startAttr,
                rowSelectionAttrNums
            );
            executePastePlan(selectedPlan);
            return;
        }

        if (isAttrInput(activeElement)) {
            var parsedFocused = parseClipboardEventMatrix(event);

            if (parsedFocused.singlePlainValue) {
                return;
            }

            event.preventDefault();
            var focusedPlan = buildFocusedPastePlan(parsedFocused, activeElement);
            executePastePlan(focusedPlan);
            return;
        }

        if (isOtherEditableTarget(activeElement)) {
            return;
        }

        var activeRow = document.querySelector('tr[data-sample-id].labeling-row-active');
        var activeRowInput = activeRow ? activeRow.querySelector('.attr-input[data-attr="1"]') : null;
        if (activeRowInput) {
            var parsedActiveRow = parseClipboardEventMatrix(event);
            if (!parsedActiveRow.singlePlainValue) {
                event.preventDefault();
                executePastePlan(buildFocusedPastePlan(parsedActiveRow, activeRowInput));
                return;
            }
        }

        event.preventDefault();
        showClipboardToast(t('toastNoTarget', 'Please click a target attribute, or select rows to paste.'), 'warning');
    }

    function bindManualInputTracking() {
        document.addEventListener('focusin', function (event) {
            if (isApplyingClipboardOperation) {
                return;
            }

            var target = event.target;
            if (!isAttrInput(target)) {
                return;
            }

            var key = getInputEditKey(target);
            if (!key) {
                return;
            }
            inputEditBeforeMap[key] = target.value || '';
        });

        document.addEventListener('input', function (event) {
            if (isApplyingClipboardOperation) {
                return;
            }

            var target = event.target;
            if (!isOtherEditableTarget(target)) {
                return;
            }

            lastOperationType = 'manual-input';

            if (isAttrInput(target)) {
                refreshModifiedState(target);
            }
        });

        document.addEventListener('change', function (event) {
            if (isApplyingClipboardOperation) {
                return;
            }

            var target = event.target;
            if (!isAttrInput(target)) {
                return;
            }

            var key = getInputEditKey(target);
            var before = key && Object.prototype.hasOwnProperty.call(inputEditBeforeMap, key)
                ? inputEditBeforeMap[key]
                : '';
            var after = target.value || '';

            if (before !== after) {
                pushPasteTransaction(createManualEditTransaction(target, before, after));
                lastOperationType = 'manual-edit';
            }

            if (key) {
                inputEditBeforeMap[key] = after;
            }
            refreshModifiedState(target);
        });
    }

    function initClipboardEnhancements() {
        bindShiftRangeSelection();
        bindCtrlWheelZoomGuard();
        bindManualInputTracking();
        document.addEventListener('copy', handleCopy);
        document.addEventListener('paste', handlePaste);
        document.addEventListener('keydown', handleUndoShortcut);
        document.addEventListener('keydown', handleClearSelectionShortcut);

        // Reset range anchor on pagination/filter navigation by page reload naturally.
    }

    document.addEventListener('DOMContentLoaded', initClipboardEnhancements);

    window.LabelingClipboard = {
        parseClipboardText: parseClipboardText,
        isHeaderRow: isHeaderRow,
        parseClipboardMatrix: parseClipboardMatrix,
        normalizeClipboardRows: normalizeClipboardRows,
        normalizeHeaderToken: normalizeHeaderToken,
        detectHeaderMapping: detectHeaderMapping,
        extractAttributeMatrix: extractAttributeMatrix,
        normalizeAttrNums: normalizeAttrNums,
        serializeAttributeRangeSelection: serializeAttributeRangeSelection,
        getRowAttributeInputs: getRowAttributeInputs,
        serializeRowAttributes: serializeRowAttributes,
        serializeSelectedRows: serializeSelectedRows,
        serializeSelectedRowsByAttrs: serializeSelectedRowsByAttrs,
        pasteValuesIntoRow: pasteValuesIntoRow,
        pasteValuesIntoSelectedRows: pasteValuesIntoSelectedRows,
        getSelectedSampleIds: getSelectedSampleIds,
        hasDestructiveOverwrite: hasDestructiveOverwrite,
        buildFocusedPastePlan: buildFocusedPastePlan,
        buildSelectedRowsPastePlan: buildSelectedRowsPastePlan,
        countDestructiveChanges: countDestructiveChanges,
        confirmPastePlan: confirmPastePlan,
        applyPastePlan: applyPastePlan,
        createPasteTransaction: createPasteTransaction,
        pushPasteTransaction: pushPasteTransaction,
        canUndoTransaction: canUndoTransaction,
        undoLastPaste: undoLastPaste,
        getLatestUndoTimestamp: getLatestUndoTimestamp,
        clearRowAttributes: clearRowAttributes,
        clearSelectionOrRowAttributes: clearSelectionOrRowAttributes,
        handleUndoShortcut: handleUndoShortcut,
        handleClearSelectionShortcut: handleClearSelectionShortcut,
        markInputModified: markInputModified,
        refreshModifiedState: refreshModifiedState,
        validatePastedInputs: validatePastedInputs,
        showClipboardToast: showClipboardToast,
        selectCheckboxRange: selectCheckboxRange,
        handleCheckboxClick: handleCheckboxClick,
        getPageSampleIdsInOrder: getPageSampleIdsInOrder,
        syncSelectionUI: syncSelectionUI,
        clearSelectedRows: clearSelectedRows
    };
})();
