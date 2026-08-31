export const NPU_PERIODS = [
    { n: 1, start: '08:30', end: '09:15', section: '上午' },
    { n: 2, start: '09:25', end: '10:10', section: '上午' },
    { n: 3, start: '10:30', end: '11:15', section: '上午' },
    { n: 4, start: '11:25', end: '12:10', section: '上午' },
    { n: 5, start: '12:20', end: '13:05', section: '中午' },
    { n: 6, start: '13:05', end: '13:50', section: '中午' },
    { n: 7, start: '14:00', end: '14:45', section: '下午' },
    { n: 8, start: '14:55', end: '15:40', section: '下午' },
    { n: 9, start: '16:00', end: '16:45', section: '下午' },
    { n: 10, start: '16:55', end: '17:40', section: '下午' },
    { n: 11, start: '19:00', end: '19:45', section: '晚上' },
    { n: 12, start: '19:55', end: '20:40', section: '晚上' },
    { n: 13, start: '20:40', end: '21:25', section: '晚上' },
];

export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export const SEMESTER_PRESETS = {
    '2026-2027秋': {
        label: '2026–2027 秋季学期',
        startDate: '2026-08-31',
        totalWeeks: 18,
    },
};

const DESCRIPTION_PATTERNS = [
    /^\d{1,2}院\b/,
    /\d{2,4}级.*(?:必修|选修|限选|课堂|方向|专业|拔尖班|二学位)/,
    /^(?:全校|公共课|学位课|社会实践|集中实践|全校本科生|备注|总学分)/,
    /^(?:专业核心|学科拓展|通识教育|基础课|实践课)/,
    /打印日期|学号|姓名|班级|学院|年级/,
];

const ROOM_PATTERNS = [
    /教(?:学)?[东西南北中](?:楼)?[A-Z]?\d{0,2}(?:-\d{2,4})?/i,
    /(?:启真|启翔|启迪|启慧|翱翔)楼\s*[A-Z]?\d{0,4}(?:-\d+)?/i,
    /(?:实验大?楼|实验室|工程训练中心|计算机实验教学中心)\s*[A-Z]?\d{0,4}(?:-\d+)?/i,
    /[一二三四五六七八九十\d]+号楼\s*[A-Z]?\d{0,4}(?:-\d+)?/i,
    /[A-Z]\d{1,2}-\d{3,4}/i,
    /[\u4e00-\u9fff]{0,8}(?:体育馆|图书馆|游泳馆|体育场|运动场|操场|游泳池)/,
    /[\u4e00-\u9fff]{1,8}(?:楼|馆|中心)\s*[A-Z]?\d{2,4}(?:-\d+)?/i,
];

const TEACHER_STOP_WORDS = new Set([
    '全校', '本科生', '研究生', '专业核心', '必修', '选修', '限选', '课堂',
    '上午', '中午', '下午', '晚上', '周次', '节次', '待定',
]);

export function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
        .replace(/[‐‑‒–—﹣－]/g, '-')
        .replace(/[〜～]/g, '~')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function clampWeek(value, totalWeeks) {
    const week = Number.parseInt(value, 10);
    return Number.isInteger(week) && week >= 1 && week <= totalWeeks ? week : null;
}

function addWeekRange(target, startValue, endValue, parity, totalWeeks) {
    let start = clampWeek(startValue, totalWeeks);
    let end = clampWeek(endValue, totalWeeks);
    if (start === null && Number(startValue) >= 1 && Number(startValue) <= 40) start = Number(startValue);
    if (end === null && Number(endValue) >= 1) end = Math.min(Number(endValue), totalWeeks);
    if (start === null || end === null) return;
    if (start > end) [start, end] = [end, start];
    for (let week = start; week <= end; week += 1) {
        if (parity === '单' && week % 2 === 0) continue;
        if (parity === '双' && week % 2 === 1) continue;
        target.add(week);
    }
}

export function parseWeekString(value, totalWeeks = 18, options = {}) {
    const source = normalizeText(value)
        .replace(/\(?\s*第?\d{1,2}\s*[-~至]\s*\d{1,2}\s*节\s*\)?/g, ' ')
        .replace(/\(?\s*第?\d{1,2}\s*节\s*\)?/g, ' ');
    if (!source) return [];

    const weeks = new Set();
    let match;
    const rangePattern = /第?\s*(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*(?:\(([单双])\)|([单双]))?\s*周(?:\s*\(([单双])\))?/g;
    while ((match = rangePattern.exec(source)) !== null) {
        addWeekRange(weeks, match[1], match[2], match[3] || match[4] || match[5], totalWeeks);
    }

    const listPattern = /第?\s*((?:\d{1,2}\s*[,，、]\s*)+\d{1,2})\s*周/g;
    while ((match = listPattern.exec(source)) !== null) {
        match[1].split(/[,，、]/).forEach(item => {
            const week = clampWeek(item, totalWeeks);
            if (week !== null) weeks.add(week);
        });
    }

    const singlePattern = /第?\s*(\d{1,2})\s*周/g;
    while ((match = singlePattern.exec(source)) !== null) {
        const week = clampWeek(match[1], totalWeeks);
        if (week !== null) weeks.add(week);
    }

    if (weeks.size === 0 && /(?:^|[^单双])单周/.test(source)) {
        addWeekRange(weeks, 1, totalWeeks, '单', totalWeeks);
    }
    if (weeks.size === 0 && /(?:^|[^单双])双周/.test(source)) {
        addWeekRange(weeks, 1, totalWeeks, '双', totalWeeks);
    }

    if (options.allowBare) {
        const bareSource = source.replace(/^[\[(]\s*|\s*[\])]$/g, '').trim();
        if (/^[\d\s,，、~至\-()单双]+$/.test(bareSource)) {
            bareSource.split(/[,，、]/).map(item => item.trim()).filter(Boolean).forEach(item => {
                const bareRange = item.match(/^(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*(?:\(([单双])\)|([单双]))?$/);
                if (bareRange) {
                    addWeekRange(weeks, bareRange[1], bareRange[2], bareRange[3] || bareRange[4], totalWeeks);
                    return;
                }
                const week = clampWeek(item, totalWeeks);
                if (week !== null) weeks.add(week);
            });
        }
    }

    return [...weeks].sort((a, b) => a - b);
}

export function splitLeadingWeekPrefix(value, totalWeeks = 18) {
    const source = normalizeText(value);
    const withWeekMarker = source.match(/^\s*[\[(]?\s*(\d{1,2}\s*[-~至]\s*\d{1,2}(?:\s*\([单双]\)|\s*[单双])?)\s*周\s*[\])]?[ \t]*(?=[\u4e00-\u9fffA-Za-z])/);
    const bareRange = source.match(/^\s*[\[(]?\s*(\d{1,2}\s*[-~至]\s*\d{1,2}(?:\s*\([单双]\)|\s*[单双])?)(?!\s*周)\s*[\])]?[ \t]*(?=[\u4e00-\u9fffA-Za-z])/);
    const match = withWeekMarker || bareRange;
    if (!match) return { text: source, weeks: [] };
    const parsedWeeks = parseWeekString(`${match[1]}周`, totalWeeks);
    if (!parsedWeeks.length) return { text: source, weeks: [] };
    return {
        text: source.slice(match[0].length).trim(),
        weeks: parsedWeeks,
    };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roomPatterns(customRooms = []) {
    const custom = customRooms
        .map(item => normalizeText(item))
        .filter(Boolean)
        .map(item => new RegExp(escapeRegExp(item), 'i'));
    return [...custom, ...ROOM_PATTERNS];
}

export function extractRoom(value, customRooms = []) {
    const source = normalizeText(value);
    for (const pattern of roomPatterns(customRooms)) {
        const match = source.match(pattern);
        if (match?.[0]) return match[0].trim();
    }
    return '';
}

export function extractPeriodRange(value, fallbackStart = 1, fallbackEnd = fallbackStart) {
    const source = normalizeText(value);
    const range = source.match(/(?:第\s*)?(\d{1,2})\s*[-~至、]\s*(\d{1,2})\s*节/);
    if (range) {
        const start = Math.max(1, Math.min(13, Number(range[1])));
        const end = Math.max(start, Math.min(13, Number(range[2])));
        return { startPeriod: start, endPeriod: end, explicit: true };
    }
    const single = source.match(/(?:第\s*)?(\d{1,2})\s*节/);
    if (single) {
        const period = Math.max(1, Math.min(13, Number(single[1])));
        return { startPeriod: period, endPeriod: period, explicit: true };
    }
    return {
        startPeriod: fallbackStart,
        endPeriod: Math.max(fallbackStart, fallbackEnd),
        explicit: false,
    };
}

function looksLikeDescription(value) {
    const source = normalizeText(value);
    return DESCRIPTION_PATTERNS.some(pattern => pattern.test(source));
}

function looksLikeRoomOnly(value, customRooms = []) {
    const source = normalizeText(value);
    const room = extractRoom(source, customRooms);
    if (!room) return false;
    const rest = source.replace(room, '').replace(/[\s,，;；:：()]/g, '');
    return rest.length === 0 || /^[\u4e00-\u9fff·]{2,8}$/.test(rest);
}

function extractTeacher(value, room, metadataLikely) {
    const source = normalizeText(value);
    const labelled = source.match(/(?:教师|老师|主讲)\s*[:：]\s*([\u4e00-\u9fffA-Za-z·]{2,20}(?:[、,，/]\s*[\u4e00-\u9fffA-Za-z·]{2,20})*)/);
    if (labelled) return labelled[1].trim();

    let tail = source;
    if (room) tail = source.slice(source.indexOf(room) + room.length);
    tail = tail
        .replace(/[()\[\]]/g, ' ')
        .replace(/第?\s*\d{1,2}\s*[-~至]\s*\d{1,2}\s*(?:周|节)/g, ' ')
        .replace(/第?\s*\d{1,2}\s*(?:周|节)/g, ' ')
        .trim();
    const candidate = tail.match(/(?:^|\s)([\u4e00-\u9fff·]{2,8}(?:[、,，/]\s*[\u4e00-\u9fff·]{2,8})*)(?:\s|$)/)?.[1]?.trim() || '';
    if (candidate && !TEACHER_STOP_WORDS.has(candidate) && !looksLikeDescription(candidate)) return candidate;

    if (metadataLikely && !room) {
        const ending = source.match(/\s([\u4e00-\u9fff·]{2,5})\s*$/)?.[1] || '';
        if (ending && !TEACHER_STOP_WORDS.has(ending) && !looksLikeDescription(ending)) return ending;
    }
    return '';
}

function firstMetadataIndex(value, customRooms = []) {
    const source = normalizeText(value);
    const indexes = [];
    const tokenPatterns = [
        /[\[(]?\s*第?\d{1,2}\s*[-~至]\s*\d{1,2}\s*(?:\([单双]\)|[单双])?\s*周/,
        /[\[(]?\s*第?\d{1,2}\s*周/,
        /[\[(]?\s*第?\d{1,2}\s*[-~至、]\s*\d{1,2}\s*节/,
        /[\[(]?\s*第?\d{1,2}\s*节/,
        /(?:教师|老师|主讲)\s*[:：]/,
    ];
    tokenPatterns.forEach(pattern => {
        const index = source.search(pattern);
        if (index >= 0) indexes.push(index);
    });
    const room = extractRoom(source, customRooms);
    if (room) indexes.push(source.indexOf(room));
    return indexes.length ? Math.min(...indexes) : -1;
}

export function cleanCourseName(value, totalWeeks = 18) {
    let source = normalizeText(value)
        .replace(/^(?:课程名称|课程)\s*[:：]\s*/, '')
        .replace(/^[·•\-—:：]+\s*/, '')
        .trim();
    source = splitLeadingWeekPrefix(source, totalWeeks).text;
    source = source
        .replace(/\s+(?:[A-Z]{2,}[A-Z0-9.-]*\d[A-Z0-9.-]*|\d{1,2})$/i, '')
        .replace(/[\s,，;；:：\-—]+$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return source;
}

function looksLikeCourseName(value, customRooms = []) {
    const source = normalizeText(value);
    if (source.length < 2 || looksLikeDescription(source) || looksLikeRoomOnly(source, customRooms)) return false;
    if (/^(?:上午|中午|下午|晚上|早晨|节次|时间|星期[一二三四五六日天]?)$/.test(source)) return false;
    if (/^[\d\s:~\-/.]+$/.test(source)) return false;
    return /[\u4e00-\u9fffA-Za-z]/.test(source);
}

function parseLineMetadata(value, context) {
    const source = normalizeText(value);
    const hasWeekMarker = /周|单周|双周/.test(source);
    const weeks = parseWeekString(source, context.totalWeeks, {
        allowBare: !hasWeekMarker && /^\s*[\[(]?\d{1,2}\s*[-~至,，、]\s*\d{1,2}/.test(source),
    });
    const period = extractPeriodRange(source, context.startPeriod, context.endPeriod);
    const room = extractRoom(source, context.customRooms);
    const metadataLikely = weeks.length > 0 || period.explicit || Boolean(room);
    const teacher = extractTeacher(source, room, metadataLikely);
    return { source, weeks, ...period, room, teacher, metadataLikely };
}

function mergeCourseRecords(records) {
    const merged = new Map();
    records.forEach(record => {
        if (!record.name) return;
        const key = [
            record.name,
            record.day,
            record.startPeriod,
            record.endPeriod,
            record.room || '',
            record.teacher || '',
        ].join('\u001f');
        const current = merged.get(key);
        if (!current) {
            merged.set(key, { ...record, weeks: [...new Set(record.weeks || [])] });
            return;
        }
        current.weeks = [...new Set([...current.weeks, ...(record.weeks || [])])];
        current.sourceText = `${current.sourceText || ''}\n${record.sourceText || ''}`.trim();
    });
    return [...merged.values()].map(record => ({
        ...record,
        weeks: record.weeks.sort((a, b) => a - b),
    }));
}

export function extractCoursesFromCell(value, options = {}) {
    const context = {
        day: options.day ?? 1,
        startPeriod: options.startPeriod ?? 1,
        endPeriod: options.endPeriod ?? options.startPeriod ?? 1,
        totalWeeks: options.totalWeeks ?? 18,
        customRooms: options.customRooms ?? [],
    };
    const text = normalizeText(value);
    if (!text) return [];

    const lines = text.split(/\n+/).map(normalizeText).filter(Boolean);
    const groups = [];
    let current = null;

    for (const rawLine of lines) {
        if (/^(?:上午|中午|下午|晚上|早晨)$/.test(rawLine) || looksLikeDescription(rawLine)) continue;

        const prefixed = splitLeadingWeekPrefix(rawLine, context.totalWeeks);
        const line = prefixed.text;
        const metadata = parseLineMetadata(line, context);
        if (prefixed.weeks.length) metadata.weeks = [...new Set([...prefixed.weeks, ...metadata.weeks])];

        const metadataIndex = firstMetadataIndex(line, context.customRooms);
        const possibleName = cleanCourseName(metadataIndex >= 0 ? line.slice(0, metadataIndex) : line, context.totalWeeks);
        const hasInlineName = looksLikeCourseName(possibleName, context.customRooms);

        if (hasInlineName) {
            const sameAsCurrent = current && cleanCourseName(current.name, context.totalWeeks) === possibleName;
            if (sameAsCurrent) {
                current.sourceText += `\n${rawLine}`;
                current.defaultWeeks = [...new Set([...(current.defaultWeeks || []), ...prefixed.weeks])];
                if (metadata.metadataLikely && (metadata.room || metadata.teacher || metadata.explicit)) {
                    current.entries.push(metadata);
                }
                continue;
            }
            current = {
                name: possibleName,
                defaultWeeks: prefixed.weeks,
                entries: [],
                fallbackRoom: '',
                fallbackTeacher: '',
                sourceText: rawLine,
            };
            groups.push(current);
            if (metadata.metadataLikely) current.entries.push(metadata);
            continue;
        }

        if (!current) {
            if (looksLikeCourseName(line, context.customRooms)) {
                current = {
                    name: cleanCourseName(line, context.totalWeeks),
                    defaultWeeks: prefixed.weeks,
                    entries: [],
                    fallbackRoom: '',
                    fallbackTeacher: '',
                    sourceText: rawLine,
                };
                groups.push(current);
            }
            continue;
        }

        current.sourceText += `\n${rawLine}`;
        if (metadata.metadataLikely) current.entries.push(metadata);
        if (!current.fallbackRoom && metadata.room) current.fallbackRoom = metadata.room;
        if (!current.fallbackTeacher && metadata.teacher) current.fallbackTeacher = metadata.teacher;
    }

    const records = [];
    groups.forEach(group => {
        const entries = group.entries.length ? group.entries : [{
            weeks: group.defaultWeeks,
            startPeriod: context.startPeriod,
            endPeriod: context.endPeriod,
            room: group.fallbackRoom,
            teacher: group.fallbackTeacher,
            explicit: false,
        }];

        entries.forEach(entry => {
            const weeks = entry.weeks?.length
                ? entry.weeks
                : group.defaultWeeks?.length
                    ? group.defaultWeeks
                    : Array.from({ length: context.totalWeeks }, (_, index) => index + 1);
            records.push({
                name: cleanCourseName(group.name, context.totalWeeks),
                room: entry.room || group.fallbackRoom || '',
                teacher: entry.teacher || group.fallbackTeacher || '',
                day: context.day,
                startPeriod: entry.startPeriod || context.startPeriod,
                endPeriod: entry.endPeriod || context.endPeriod,
                weeks: [...new Set(weeks)].sort((a, b) => a - b),
                sourceText: group.sourceText,
            });
        });
    });

    return mergeCourseRecords(records);
}

function cellText(cell) {
    const parts = [];
    const walk = node => {
        if (node.nodeType === 3) parts.push(node.textContent || '');
        else if (node.nodeName === 'BR') parts.push('\n');
        else {
            node.childNodes?.forEach(walk);
            if (/^(P|DIV|LI|TR)$/.test(node.nodeName)) parts.push('\n');
        }
    };
    walk(cell);
    return normalizeText(parts.join(''));
}

export function buildGrid(table) {
    const grid = {};
    const occupied = new Set();
    let rowIndex = 0;
    table.querySelectorAll('tr').forEach(row => {
        let columnIndex = 0;
        row.querySelectorAll(':scope > th, :scope > td').forEach(cell => {
            while (occupied.has(`${rowIndex},${columnIndex}`)) columnIndex += 1;
            const rowSpan = Math.max(1, Number.parseInt(cell.getAttribute('rowspan') || '1', 10));
            const colSpan = Math.max(1, Number.parseInt(cell.getAttribute('colspan') || '1', 10));
            const text = cellText(cell);
            for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
                for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
                    const row = rowIndex + rowOffset;
                    const column = columnIndex + colOffset;
                    grid[row] ??= {};
                    occupied.add(`${row},${column}`);
                    grid[row][column] = {
                        text: rowOffset === 0 && colOffset === 0 ? text : '',
                        rowspan: rowSpan,
                        colspan: colSpan,
                        origin: rowOffset === 0 && colOffset === 0,
                        sourceRow: rowIndex,
                        sourceColumn: columnIndex,
                    };
                }
            }
            columnIndex += colSpan;
        });
        rowIndex += 1;
    });
    return grid;
}

function dayNumber(value) {
    const source = normalizeText(value).replace(/\s+/g, '');
    const chinese = source.match(/^(?:星期|周)?([一二三四五六日天])$/)?.[1];
    if (chinese) return ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 })[chinese];
    const english = source.toLowerCase();
    const names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const index = names.indexOf(english);
    return index >= 0 ? index + 1 : null;
}

function tableScore(table) {
    const cells = [...table.querySelectorAll('th,td')];
    const days = new Set(cells.map(cell => dayNumber(cell.textContent)).filter(Boolean));
    const periods = cells.filter(cell => /第?\s*\d{1,2}\s*节|^\s*(?:[1-9]|1[0-3])\s*$/.test(normalizeText(cell.textContent))).length;
    const entries = cells.filter(cell => /\d{1,2}\s*[-~至]\s*\d{1,2}\s*周/.test(normalizeText(cell.textContent))).length;
    return days.size * 100 + periods * 3 + entries * 5 + Math.min(cells.length, 200) / 100;
}

function selectScheduleTable(document) {
    const tables = [...document.querySelectorAll('table')];
    return tables.sort((left, right) => tableScore(right) - tableScore(left))[0] || null;
}

function detectDayRow(grid, rowIndexes) {
    let best = { row: -1, map: {}, count: 0 };
    rowIndexes.forEach(row => {
        const map = {};
        Object.entries(grid[row] || {}).forEach(([column, cell]) => {
            if (!cell.origin) return;
            const day = dayNumber(cell.text);
            if (day) map[Number(column)] = day;
        });
        const count = Object.keys(map).length;
        if (count > best.count) best = { row, map, count };
    });
    return best;
}

function detectPeriod(value) {
    const source = normalizeText(value);
    const explicit = source.match(/第\s*(\d{1,2})\s*节/)?.[1];
    const plain = source.match(/^\s*(\d{1,2})\s*$/)?.[1];
    const period = Number(explicit || plain || 0);
    return period >= 1 && period <= 13 ? period : null;
}

export function parseScheduleTable(table, options = {}) {
    const totalWeeks = options.totalWeeks ?? 18;
    const customRooms = options.customRooms ?? [];
    const grid = buildGrid(table);
    const rows = Object.keys(grid).map(Number).sort((a, b) => a - b);
    if (!rows.length) return { courses: [], warnings: ['课表表格为空'], grid };

    const dayHeader = detectDayRow(grid, rows);
    if (dayHeader.count < 3) return { courses: [], warnings: ['没有找到完整的星期标题行'], grid };
    const dayColumns = Object.keys(dayHeader.map).map(Number).sort((a, b) => a - b);
    const firstDayColumn = Math.min(...dayColumns);
    const dataRows = rows.filter(row => row > dayHeader.row);

    let periodColumn = 0;
    let periodScore = -1;
    for (let column = 0; column < firstDayColumn; column += 1) {
        const score = dataRows.reduce((sum, row) => sum + (detectPeriod(grid[row]?.[column]?.text) ? 1 : 0), 0);
        if (score > periodScore) {
            periodColumn = column;
            periodScore = score;
        }
    }

    const rowPeriods = {};
    let lastPeriod = 0;
    dataRows.forEach(row => {
        let detected = detectPeriod(grid[row]?.[periodColumn]?.text);
        if (!detected) {
            for (let column = 0; column < firstDayColumn; column += 1) {
                detected = detectPeriod(grid[row]?.[column]?.text);
                if (detected) break;
            }
        }
        if (detected) lastPeriod = detected;
        if (lastPeriod) rowPeriods[row] = lastPeriod;
    });

    const courses = [];
    dataRows.forEach(row => {
        const startPeriod = rowPeriods[row];
        if (!startPeriod) return;
        dayColumns.forEach(column => {
            const cell = grid[row]?.[column];
            if (!cell?.origin || !normalizeText(cell.text)) return;
            let endPeriod = startPeriod;
            for (let spannedRow = row; spannedRow < row + cell.rowspan; spannedRow += 1) {
                if (rowPeriods[spannedRow]) endPeriod = Math.max(endPeriod, rowPeriods[spannedRow]);
            }
            if (cell.rowspan > 1 && endPeriod === startPeriod) {
                endPeriod = Math.min(13, startPeriod + cell.rowspan - 1);
            }
            courses.push(...extractCoursesFromCell(cell.text, {
                day: dayHeader.map[column],
                startPeriod,
                endPeriod,
                totalWeeks,
                customRooms,
            }));
        });
    });

    const merged = mergeCourseRecords(courses);
    return {
        courses: merged,
        warnings: periodScore <= 0 ? ['节次列识别置信度较低，请核对预览'] : [],
        grid,
        diagnostics: {
            rows: rows.length,
            columns: Math.max(...rows.flatMap(row => Object.keys(grid[row]).map(Number))) + 1,
            dayHeaderRow: dayHeader.row,
            periodColumn,
        },
    };
}

export function parseDocumentMetadata(document) {
    const text = normalizeText(document.body?.textContent || document.documentElement?.textContent || document.textContent || '');
    const semester = text.match(/(20\d{2})\s*[-–—]\s*(20\d{2})\s*(秋|春)(?:季)?/) || [];
    const semesterKey = semester.length ? `${semester[1]}-${semester[2]}${semester[3]}` : '';
    return {
        semesterKey,
        semesterName: semesterKey,
        preset: SEMESTER_PRESETS[semesterKey] || null,
    };
}

export function parseScheduleDocument(document, options = {}) {
    const table = selectScheduleTable(document);
    if (!table) return { courses: [], warnings: ['文档中没有找到表格'], metadata: parseDocumentMetadata(document), grid: null };
    const parsed = parseScheduleTable(table, options);
    return { ...parsed, metadata: parseDocumentMetadata(document) };
}

export function formatWeeks(weeks = []) {
    const sorted = [...new Set(weeks)].sort((a, b) => a - b);
    if (!sorted.length) return '未设置';
    const ranges = [];
    let start = sorted[0];
    let end = start;
    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index] === end + 1) end = sorted[index];
        else {
            ranges.push(start === end ? `${start}` : `${start}-${end}`);
            start = sorted[index];
            end = start;
        }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return `${ranges.join('、')}周`;
}

export function analyzeSchedule(courses, totalWeeks = 18) {
    const issues = [];
    const slotOwners = new Map();
    const conflictMap = new Map();

    courses.forEach((course, index) => {
        if (!course.name) issues.push({ level: 'error', courseIndex: index, message: '发现没有课程名称的条目' });
        if (/^\d{1,2}\s*[-~至]\s*\d{1,2}(?=[\u4e00-\u9fffA-Za-z])/.test(course.name)) {
            issues.push({ level: 'error', courseIndex: index, message: `“${course.name}”疑似把周次拼进了课程名` });
        }
        if (!course.weeks?.length) issues.push({ level: 'error', courseIndex: index, message: `“${course.name}”缺少上课周次` });
        if (!course.room) issues.push({ level: 'warning', courseIndex: index, message: `“${course.name}”没有识别到教室` });
        if (!course.teacher) issues.push({ level: 'info', courseIndex: index, message: `“${course.name}”没有识别到教师` });
        if (course.day < 1 || course.day > 7 || course.startPeriod < 1 || course.endPeriod > 13) {
            issues.push({ level: 'error', courseIndex: index, message: `“${course.name}”的星期或节次超出范围` });
        }
        (course.weeks || []).forEach(week => {
            if (week < 1 || week > totalWeeks) return;
            for (let period = course.startPeriod; period <= course.endPeriod; period += 1) {
                const slot = `${course.day}-${week}-${period}`;
                const owners = slotOwners.get(slot) || [];
                owners.forEach(owner => {
                    if (owner.index === index) return;
                    const pair = [owner.index, index].sort((a, b) => a - b).join('-');
                    const key = `${pair}-${course.day}-${week}`;
                    if (!conflictMap.has(key)) {
                        conflictMap.set(key, {
                            firstIndex: owner.index,
                            secondIndex: index,
                            day: course.day,
                            week,
                            period,
                        });
                    }
                });
                owners.push({ index, course });
                slotOwners.set(slot, owners);
            }
        });
    });

    const conflicts = [...conflictMap.values()];
    conflicts.forEach(conflict => {
        const first = courses[conflict.firstIndex];
        const second = courses[conflict.secondIndex];
        issues.push({
            level: 'warning',
            courseIndex: conflict.secondIndex,
            message: `第${conflict.week}周${DAYS[conflict.day - 1]}：${first.name} 与 ${second.name} 时间重叠`,
        });
    });

    const errorCount = issues.filter(issue => issue.level === 'error').length;
    const warningCount = issues.filter(issue => issue.level === 'warning').length;
    const confidence = Math.max(0, Math.round(100 - errorCount * 18 - warningCount * 4));
    return {
        issues,
        conflicts,
        confidence,
        recordCount: courses.length,
        subjectCount: new Set(courses.map(course => course.name)).size,
        sessionCount: courses.reduce((sum, course) => sum + (course.weeks?.length || 0), 0),
        canExport: courses.length > 0 && errorCount === 0,
    };
}

function escapeIcs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\r?\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

function foldIcsLine(line) {
    const encoder = new TextEncoder();
    const output = [];
    let chunk = '';
    let bytes = 0;
    for (const character of line) {
        const charBytes = encoder.encode(character).length;
        const limit = output.length === 0 ? 75 : 74;
        if (bytes + charBytes > limit && chunk) {
            output.push(chunk);
            chunk = character;
            bytes = charBytes;
        } else {
            chunk += character;
            bytes += charBytes;
        }
    }
    if (chunk || !output.length) output.push(chunk);
    return output.join('\r\n ');
}

function addDays(isoDate, dayCount) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + dayCount);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function utcStamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateIcs(options) {
    const courses = options.courses || [];
    const periods = options.periods || NPU_PERIODS;
    const anchorDate = options.anchorDate;
    const anchorWeek = Number(options.anchorWeek || 1);
    const semesterName = normalizeText(options.semesterName || '西工大课表');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate || '')) throw new Error('请设置校历周一日期');

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//NPU Chang’an Schedule//CN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeIcs(semesterName)}课程表`,
        'X-WR-TIMEZONE:Asia/Shanghai',
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Shanghai',
        'X-LIC-LOCATION:Asia/Shanghai',
        'BEGIN:STANDARD',
        'TZOFFSETFROM:+0800',
        'TZOFFSETTO:+0800',
        'TZNAME:CST',
        'DTSTART:19700101T000000',
        'END:STANDARD',
        'END:VTIMEZONE',
    ];
    const stamp = utcStamp(options.now);
    let eventCount = 0;

    courses.forEach(course => {
        const start = periods[course.startPeriod - 1];
        const end = periods[course.endPeriod - 1] || start;
        if (!start || !end) return;
        (course.weeks || []).forEach(week => {
            const date = addDays(anchorDate, (week - anchorWeek) * 7 + course.day - 1);
            const startTime = start.start.replace(':', '');
            const endTime = end.end.replace(':', '');
            const summary = course.room ? `${course.name} · ${course.room}` : course.name;
            const description = [
                course.teacher ? `教师：${course.teacher}` : '',
                `周次：第${week}周（${formatWeeks(course.weeks)}）`,
                `节次：第${course.startPeriod}-${course.endPeriod}节`,
                '校区：长安校区',
            ].filter(Boolean).join('\n');
            const identity = [course.name, course.room, course.teacher, course.day, course.startPeriod, course.endPeriod, week, date].join('|');
            lines.push(
                'BEGIN:VEVENT',
                `UID:${stableHash(identity)}-${date}@npu-calendar.local`,
                `DTSTAMP:${stamp}`,
                `DTSTART;TZID=Asia/Shanghai:${date}T${startTime}00`,
                `DTEND;TZID=Asia/Shanghai:${date}T${endTime}00`,
                `SUMMARY:${escapeIcs(summary)}`,
                course.room ? `LOCATION:${escapeIcs(course.room)}` : '',
                `DESCRIPTION:${escapeIcs(description)}`,
                'STATUS:CONFIRMED',
                'TRANSP:OPAQUE',
                'END:VEVENT',
            );
            eventCount += 1;
        });
    });
    lines.push('END:VCALENDAR');
    return {
        content: lines.filter(Boolean).map(foldIcsLine).join('\r\n'),
        eventCount,
    };
}
