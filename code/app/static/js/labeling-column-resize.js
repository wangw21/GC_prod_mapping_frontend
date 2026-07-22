(function () {
    'use strict';

    var STORAGE_KEY = 'labelingAttributeColumnWidths';
    var ATTR_COLUMN_INDEXES = [8, 9, 10, 11, 12];
    var FIXED_COLUMN_WIDTHS = {
        0: 30,
        5: 42,
        6: 54,
        13: 88
    };
    var FLEX_COLUMN_INDEXES = [2, 3, 4, 7];
    var FLEX_MIN_WIDTHS = [54, 96, 72, 54];
    var FLEX_PREFERRED_WIDTHS = [78, 210, 138, 78];
    var DEFAULT_WIDTH = 118;
    var MIN_WIDTH = 96;
    var MAX_WIDTH = 360;

    function getConfig() {
        return window.labelingColumnResizeConfig || {};
    }

    function getStorageKey() {
        return STORAGE_KEY + ':' + String(getConfig().userKey || 'anonymous');
    }

    function readWidths() {
        try {
            var stored = JSON.parse(window.localStorage.getItem(getStorageKey()));
            return stored && typeof stored === 'object' ? stored : {};
        } catch (error) {
            return {};
        }
    }

    function saveWidths(widths) {
        try {
            window.localStorage.setItem(getStorageKey(), JSON.stringify(widths));
        } catch (error) {
            // Keep the adjusted widths for the current view if storage is unavailable.
        }
    }

    function constrainWidth(width) {
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    }

    function setColumnWidth(table, cellIndex, width) {
        var rounded = Math.max(1, Math.round(width));
        var header = table.tHead && table.tHead.rows.length ? table.tHead.rows[0].cells[cellIndex] : null;
        if (header) {
            header.style.width = rounded + 'px';
            header.style.minWidth = rounded + 'px';
            header.style.maxWidth = rounded + 'px';
        }
        Array.from(table.tBodies).forEach(function (tbody) {
            Array.from(tbody.rows).forEach(function (row) {
                var cell = row.cells[cellIndex];
                if (!cell) {
                    return;
                }
                cell.style.width = rounded + 'px';
                cell.style.minWidth = rounded + 'px';
                cell.style.maxWidth = rounded + 'px';
            });
        });
    }

    function sum(values) {
        return values.reduce(function (total, value) {
            return total + value;
        }, 0);
    }

    function getAvailableWidth(table) {
        var container = table.parentElement;
        return Math.max(1, Math.floor(container ? container.clientWidth : table.clientWidth));
    }

    function getAttributeWidths(headers, storedWidths) {
        return headers.map(function (header) {
            var attrNum = String(header.dataset.labelAttr || '');
            var stored = Number(storedWidths[attrNum]);
            return constrainWidth(Number.isFinite(stored) ? stored : DEFAULT_WIDTH);
        });
    }

    function fitAttributeWidths(desiredWidths, capacity, activeIndex) {
        var widths = desiredWidths.map(constrainWidth);
        var minimumTotal = MIN_WIDTH * widths.length;
        var safeCapacity = Math.max(minimumTotal, capacity);
        var overflow = sum(widths) - safeCapacity;

        if (overflow <= 0) {
            return widths;
        }

        var shrinkIndexes = widths.map(function (_, index) { return index; }).filter(function (index) {
            return index !== activeIndex;
        });

        function shrinkEvenly(indexes) {
            while (overflow > 0.5 && indexes.length > 0) {
                var share = overflow / indexes.length;
                indexes = indexes.filter(function (index) {
                    var reducible = widths[index] - MIN_WIDTH;
                    var reduction = Math.min(reducible, share);
                    widths[index] -= reduction;
                    overflow -= reduction;
                    return widths[index] > MIN_WIDTH + 0.5;
                });
            }
        }

        shrinkEvenly(shrinkIndexes);
        if (overflow > 0.5 && activeIndex >= 0) {
            shrinkEvenly([activeIndex]);
        }

        return widths;
    }

    function allocateFlexibleWidths(budget) {
        var minimumTotal = sum(FLEX_MIN_WIDTHS);
        var preferredTotal = sum(FLEX_PREFERRED_WIDTHS);
        if (budget <= minimumTotal) {
            return FLEX_MIN_WIDTHS.slice();
        }
        if (budget >= preferredTotal) {
            var preferred = FLEX_PREFERRED_WIDTHS.slice();
            preferred[1] += budget - preferredTotal;
            return preferred;
        }

        var ratio = (budget - minimumTotal) / (preferredTotal - minimumTotal);
        return FLEX_MIN_WIDTHS.map(function (minimum, index) {
            return minimum + (FLEX_PREFERRED_WIDTHS[index] - minimum) * ratio;
        });
    }

    function applyLayout(table, headers, desiredWidths, activeIndex) {
        var availableWidth = getAvailableWidth(table);
        var fixedTotal = Object.keys(FIXED_COLUMN_WIDTHS).reduce(function (total, key) {
            return total + FIXED_COLUMN_WIDTHS[key];
        }, 0);
        var flexMinimumTotal = sum(FLEX_MIN_WIDTHS);
        var attrCapacity = availableWidth - fixedTotal - flexMinimumTotal;
        var attrWidths = fitAttributeWidths(desiredWidths, attrCapacity, activeIndex);
        var requiredWidth = fixedTotal + flexMinimumTotal + sum(attrWidths);
        var tableWidth = Math.max(availableWidth, requiredWidth);
        var flexibleWidths = allocateFlexibleWidths(tableWidth - fixedTotal - sum(attrWidths));

        table.style.width = tableWidth + 'px';
        table.style.minWidth = tableWidth + 'px';
        table.style.maxWidth = tableWidth + 'px';

        Object.keys(FIXED_COLUMN_WIDTHS).forEach(function (key) {
            setColumnWidth(table, Number(key), FIXED_COLUMN_WIDTHS[key]);
        });
        FLEX_COLUMN_INDEXES.forEach(function (cellIndex, index) {
            setColumnWidth(table, cellIndex, flexibleWidths[index]);
        });
        ATTR_COLUMN_INDEXES.forEach(function (cellIndex, index) {
            setColumnWidth(table, cellIndex, attrWidths[index]);
        });

        return attrWidths;
    }

    function createResizeHandle(table, header, headers, widths) {
        var attrNum = String(header.dataset.labelAttr || '');
        if (!attrNum) {
            return;
        }

        header.classList.add('labeling-resizable-attr-header');

        var handle = document.createElement('span');
        handle.className = 'labeling-column-resize-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', getConfig().resizeTitle || 'Drag to resize this attribute column');
        handle.title = getConfig().resizeTitle || 'Drag to resize this attribute column';
        header.appendChild(handle);

        var resizeState = null;

        handle.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) {
                return;
            }

            resizeState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                activeIndex: headers.indexOf(header),
                startWidths: headers.map(function (candidate) {
                    return constrainWidth(candidate.getBoundingClientRect().width);
                }),
                startWidth: header.getBoundingClientRect().width
            };
            document.body.classList.add('labeling-column-resizing');
            handle.classList.add('is-active');
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        });

        handle.addEventListener('pointermove', function (event) {
            if (!resizeState || event.pointerId !== resizeState.pointerId) {
                return;
            }
            var nextWidths = resizeState.startWidths.slice();
            nextWidths[resizeState.activeIndex] = constrainWidth(
                resizeState.startWidth + event.clientX - resizeState.startX
            );
            applyLayout(table, headers, nextWidths, resizeState.activeIndex);
        });

        function finishResize(event) {
            if (!resizeState || event.pointerId !== resizeState.pointerId) {
                return;
            }

            var finalWidths = headers.map(function (candidate) {
                return constrainWidth(candidate.getBoundingClientRect().width);
            });
            headers.forEach(function (candidate, index) {
                widths[String(candidate.dataset.labelAttr || '')] = finalWidths[index];
            });
            saveWidths(widths);
            document.body.classList.remove('labeling-column-resizing');
            handle.classList.remove('is-active');
            resizeState = null;
        }

        handle.addEventListener('pointerup', finishResize);
        handle.addEventListener('pointercancel', finishResize);
    }

    function initColumnResize() {
        var table = document.getElementById('samplesTable');
        if (!table) {
            return;
        }

        var widths = readWidths();
        var headers = Array.from(table.querySelectorAll('thead th[data-label-attr]'));
        applyLayout(table, headers, getAttributeWidths(headers, widths), -1);
        headers.forEach(function (header) {
            createResizeHandle(table, header, headers, widths);
        });

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            if (resizeTimer) window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(function () {
                applyLayout(table, headers, getAttributeWidths(headers, widths), -1);
            }, 100);
        });
    }

    document.addEventListener('DOMContentLoaded', initColumnResize);
})();
