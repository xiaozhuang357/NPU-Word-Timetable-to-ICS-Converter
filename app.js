import {
    DAYS,
    NPU_PERIODS,
    SEMESTER_PRESETS,
    analyzeSchedule,
    consolidateCourseRecords,
    formatWeeks,
    generateIcs,
    normalizeText,
    parseScheduleDocument,
    parseWeekString,
} from './schedule-core.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
    courses: [],
    periods: NPU_PERIODS.map(period => ({ ...period })),
    parseWarnings: [],
    parseMessages: [],
    grid: null,
    fileBuffer: null,
    fileName: '',
    activeDay: 1,
    viewMode: 'all',
    activeWeek: 1,
    currentRealWeek: null,
    editingId: null,
    selectedWeeks: new Set(),
    nextId: 1,
    toastTimer: null,
    clearTimer: null,
};

const COURSE_COLORS = ['#007aff', '#5856d6', '#af52de', '#ff2d55', '#ff9500', '#00a6a6', '#34c759'];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function colorForCourse(course) {
    let hash = 0;
    for (const character of course.name || '') hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
}

function periodLabel(course) {
    return course.startPeriod === course.endPeriod
        ? `第 ${course.startPeriod} 节`
        : `第 ${course.startPeriod}–${course.endPeriod} 节`;
}

function totalWeeks() {
    return Math.max(1, Math.min(30, Number.parseInt($('#total-weeks').value, 10) || 18));
}

function customRooms() {
    return normalizeText($('#custom-rooms').value)
        .split(/[,，\n]/)
        .map(value => value.trim())
        .filter(Boolean);
}

function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function setFlowStep(activeStep) {
    $$('.flow-step').forEach(element => {
        const step = Number(element.dataset.step);
        element.classList.toggle('is-active', step === activeStep);
        element.classList.toggle('is-done', step < activeStep);
    });
}

function setParseState(type, title, detail, percent) {
    const container = $('#parse-state');
    container.hidden = false;
    container.classList.toggle('is-done', type === 'done');
    container.classList.toggle('is-error', type === 'error');
    $('#state-title').textContent = title;
    $('#state-detail').textContent = detail;
    $('#state-percent').textContent = type === 'error' ? '异常' : `${percent}%`;
    $('#progress-bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function updateDropZone(fileName = '') {
    $('#drop-title').textContent = fileName || '拖入课表，或点击选择';
    $('#drop-subtitle').textContent = fileName ? '文件已就绪，可随时重新识别' : '支持教务系统导出的 .docx 文件 · 仅在本机处理';
    $('#reparse-button').hidden = !state.fileBuffer;
}

function parseMessage(message) {
    state.parseMessages.push(message);
}

function renderDiagnostics() {
    const details = $('#diagnostics');
    details.hidden = state.parseMessages.length === 0 && !state.grid;
    $('#parse-log').innerHTML = state.parseMessages.map(message => `<li>${escapeHtml(message)}</li>`).join('');
    const debug = $('#debug-grid');
    if (!state.grid) {
        debug.innerHTML = '';
        return;
    }

    const rows = Object.keys(state.grid).map(Number).sort((a, b) => a - b);
    const maxColumn = Math.max(...rows.flatMap(row => Object.keys(state.grid[row]).map(Number)));
    const html = rows.map(row => {
        const cells = [];
        for (let column = 0; column <= maxColumn; column += 1) {
            const cell = state.grid[row]?.[column];
            const text = cell?.origin ? normalizeText(cell.text).replace(/\n/g, ' ↵ ') : '';
            cells.push(`<td title="R${row} C${column}">${escapeHtml(text.slice(0, 80))}</td>`);
        }
        return `<tr>${cells.join('')}</tr>`;
    }).join('');
    debug.innerHTML = `<table><tbody>${html}</tbody></table>`;
}

function initTheme() {
    const saved = window.localStorage.getItem('npu-calendar-theme');
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (systemDark ? 'dark' : 'light');
    $('#theme-toggle').addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        window.localStorage.setItem('npu-calendar-theme', next);
        document.querySelector('meta[name="theme-color"]').setAttribute('content', next === 'dark' ? '#09090b' : '#f5f5f7');
    });
}

function renderPeriodSettings() {
    $('#period-list').innerHTML = state.periods.map(period => `
        <label class="period-row">
            <span>第 ${period.n} 节</span>
            <input type="time" value="${period.start}" data-period="${period.n}" data-kind="start" aria-label="第 ${period.n} 节开始时间">
            <i>–</i>
            <input type="time" value="${period.end}" data-period="${period.n}" data-kind="end" aria-label="第 ${period.n} 节结束时间">
        </label>
    `).join('');
}

function renderEditorOptions() {
    $('#course-day').innerHTML = DAYS.map((day, index) => `<option value="${index + 1}">${day}</option>`).join('');
    const options = state.periods.map(period => `<option value="${period.n}">第 ${period.n} 节 · ${period.start}</option>`).join('');
    $('#course-start-period').innerHTML = options;
    $('#course-end-period').innerHTML = options;
}

function applySemesterPreset(key) {
    const preset = SEMESTER_PRESETS[key];
    if (!preset) return;
    $('#start-date').value = preset.startDate;
    $('#total-weeks').value = String(preset.totalWeeks);
    $('#semester-name').value = `${preset.label.replace('季学期', '').trim()} · 西工大`;
    renderWeekNav();
}

async function handleFile(file) {
    if (!file) return;
    if (/\.doc$/i.test(file.name)) {
        setParseState('error', '暂不支持旧版 .doc', '请在 Word 中“另存为” .docx 后重试。', 100);
        showToast('请先将旧版 .doc 文件另存为 .docx');
        return;
    }
    if (!/\.docx$/i.test(file.name)) {
        setParseState('error', '文件格式不受支持', '请选择教务系统导出的 .docx 课表。', 100);
        showToast('请选择 .docx 格式的课表');
        return;
    }

    state.fileName = file.name;
    updateDropZone(file.name);
    setFlowStep(2);
    setParseState('loading', '正在读取课表', '文件只会在当前浏览器中处理。', 12);
    state.parseMessages = [];
    parseMessage(`载入文件：${file.name}`);

    try {
        state.fileBuffer = await file.arrayBuffer();
        await parseCurrentFile();
    } catch (error) {
        console.error(error);
        setParseState('error', '课表读取失败', error.message || '文件可能已损坏，请重新导出后再试。', 100);
        parseMessage(`识别失败：${error.message || '未知错误'}`);
        renderDiagnostics();
        showToast('课表读取失败，请检查文件后重试');
    }
}

async function parseCurrentFile() {
    if (!state.fileBuffer) return;
    if (!window.mammoth?.convertToHtml) throw new Error('Word 解析组件未能加载');

    setFlowStep(2);
    setParseState('loading', '正在解析 Word 表格', '还原合并单元格与星期、节次坐标。', 34);
    await new Promise(resolve => window.setTimeout(resolve, 40));

    const converted = await window.mammoth.convertToHtml({ arrayBuffer: state.fileBuffer });
    converted.messages.slice(0, 5).forEach(message => parseMessage(`Word 提示：${message.message}`));
    setParseState('loading', '正在识别课程字段', '拆分课程名、周次、节次、教室与教师。', 62);
    await new Promise(resolve => window.setTimeout(resolve, 40));

    const document = new DOMParser().parseFromString(converted.value, 'text/html');
    const parsed = parseScheduleDocument(document, {
        totalWeeks: totalWeeks(),
        customRooms: customRooms(),
    });
    state.grid = parsed.grid;
    state.parseWarnings = parsed.warnings || [];
    state.parseWarnings.forEach(message => parseMessage(`需要核对：${message}`));

    if (parsed.metadata?.semesterKey) {
        parseMessage(`识别到学期：${parsed.metadata.semesterKey}`);
        if (parsed.metadata.preset) {
            $('#semester-preset').value = parsed.metadata.semesterKey;
            applySemesterPreset(parsed.metadata.semesterKey);
        } else {
            $('#semester-preset').value = 'custom';
            $('#semester-name').value = parsed.metadata.semesterName;
        }
    }

    state.courses = parsed.courses.map(course => ({ ...course, id: state.nextId++ }));
    initializeWeekView();
    const diagnostics = parsed.diagnostics;
    if (diagnostics) {
        parseMessage(`表格结构：${diagnostics.rows} 行 × ${diagnostics.columns} 列`);
        parseMessage(`星期标题：第 ${diagnostics.dayHeaderRow + 1} 行；节次列：第 ${diagnostics.periodColumn + 1} 列`);
    }

    renderDiagnostics();
    if (!state.courses.length) {
        setParseState('error', '没有识别到课程', '请展开识别详情核对表格，或手动添加课程。', 100);
        renderAll();
        showToast('未识别到课程，可查看详情或手动添加');
        return;
    }

    const analysis = analyzeSchedule(state.courses, totalWeeks());
    setParseState(
        'done',
        `已识别 ${analysis.subjectCount} 门课程`,
        `${analysis.recordCount} 条排课段，展开后共 ${analysis.sessionCount} 次课。`,
        100,
    );
    parseMessage(`识别完成：${analysis.subjectCount} 门课程、${analysis.recordCount} 条排课段`);
    renderDiagnostics();
    renderAll();
    setFlowStep(3);
    showToast(`识别完成，共 ${analysis.sessionCount} 次课`);
    window.setTimeout(() => $('#review-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
}

function loadDemo() {
    state.fileBuffer = null;
    state.fileName = '';
    state.parseWarnings = [];
    state.parseMessages = ['已载入演示课表，用于体验核对和导出流程。'];
    state.courses = consolidateCourseRecords([
        { name: '大学英语核心能力', room: '教西 B1-302', teacher: '李老师', day: 1, startPeriod: 3, endPeriod: 4, weeks: [10, 11, 12, 13, 14, 15, 16, 17] },
        { name: '算法分析与设计', room: '启真楼 204-2', teacher: '罗建超', day: 3, startPeriod: 1, endPeriod: 2, weeks: [8, 9, 10, 11] },
        { name: '软件测试', room: '启真楼 204-2', teacher: '郑炜', day: 5, startPeriod: 1, endPeriod: 2, weeks: [11, 12, 13, 14] },
        { name: '软件测试', room: '启真楼 204-2', teacher: '高利鹏', day: 5, startPeriod: 1, endPeriod: 2, weeks: [15, 16] },
        { name: '软件测试', room: '启真楼 204-2', teacher: '蔡文静', day: 5, startPeriod: 1, endPeriod: 2, weeks: [17, 18] },
        { name: '互联网系统综合项目实践', room: '教西 B1-203', teacher: '金强国', day: 2, startPeriod: 11, endPeriod: 13, weeks: [9, 10, 11, 12, 13] },
    ]).map(course => ({ ...course, id: state.nextId++ }));
    initializeWeekView();
    updateDropZone();
    renderDiagnostics();
    setParseState('done', '演示课表已就绪', '包含周次拆分、三节连排与换教师场景。', 100);
    renderAll();
    setFlowStep(3);
    $('#review-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function visibleCourses() {
    if (state.viewMode === 'all' || !state.activeWeek) return state.courses;
    return state.courses.filter(course => course.weeks.includes(state.activeWeek));
}

function renderStats(analysis) {
    const stats = [
        {
            value: analysis.subjectCount,
            label: '不同课程',
            icon: '<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/>',
        },
        {
            value: analysis.recordCount,
            label: '排课段',
            icon: '<path d="M4 6h16M4 12h16M4 18h10"/>',
        },
        {
            value: analysis.sessionCount,
            label: '实际课次',
            icon: '<path d="M4 5h16v15H4zM8 3v4M16 3v4M4 9h16"/>',
        },
        {
            value: analysis.conflicts.length,
            label: '时间冲突',
            icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
        },
    ];
    $('#stat-grid').innerHTML = stats.map(stat => `
        <div class="stat-card">
            <span class="stat-symbol"><svg viewBox="0 0 24 24" aria-hidden="true">${stat.icon}</svg></span>
            <div><strong>${stat.value}</strong><small>${stat.label}</small></div>
        </div>
    `).join('');
}

function combinedIssues(analysis) {
    return [
        ...state.parseWarnings.map(message => ({ level: 'warning', courseIndex: null, message })),
        ...analysis.issues,
    ];
}

function renderQuality(analysis) {
    const issues = combinedIssues(analysis);
    const errors = issues.filter(issue => issue.level === 'error');
    const warnings = issues.filter(issue => issue.level === 'warning');
    const score = Math.max(0, analysis.confidence - state.parseWarnings.length * 4);
    const card = $('#quality-card');
    card.classList.toggle('has-errors', errors.length > 0);
    card.classList.toggle('has-warnings', errors.length === 0 && warnings.length > 0);
    $('#quality-gauge').style.setProperty('--quality-angle', `${score}%`);
    $('#quality-score').textContent = score;

    if (errors.length) {
        $('#quality-title').textContent = `有 ${errors.length} 个关键问题需要处理`;
        $('#quality-detail').textContent = '修正异常课程名或缺失周次后即可导出。';
    } else if (warnings.length) {
        $('#quality-title').textContent = `结果可用，建议核对 ${warnings.length} 项`;
        $('#quality-detail').textContent = '主要是缺失教室或检测到时间重叠，不会替你擅自修改。';
    } else {
        $('#quality-title').textContent = '识别结果很干净，可以导出';
        $('#quality-detail').textContent = '未发现重复、周次黏连或时间冲突。';
    }

    const toggle = $('#toggle-issues');
    toggle.hidden = issues.length === 0;
    toggle.textContent = $('#issue-list').hidden ? `查看 ${issues.length} 项` : '收起问题';
    $('#issue-list').innerHTML = issues.map((issue, index) => `
        <div class="issue-item" data-level="${issue.level}">
            <span class="issue-dot"></span>
            <span>${escapeHtml(issue.message)}</span>
            ${Number.isInteger(issue.courseIndex) ? `<button type="button" data-issue-index="${issue.courseIndex}">修改</button>` : ''}
        </div>
    `).join('');
    $('#export-button').disabled = !analysis.canExport;
}

function currentSemesterWeek() {
    const dateValue = $('#start-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
    const anchor = new Date(`${dateValue}T00:00:00`);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayDiff = Math.round((startOfToday - anchor) / 86400000);
    const week = Math.floor(dayDiff / 7) + 1;
    const total = totalWeeks();
    if (week < 1 || week > total) return null;
    return { week, day: ((startOfToday.getDay() + 6) % 7) + 1 };
}

function teachersForWeek(course) {
    if (state.viewMode !== 'week' || !state.activeWeek) return '';
    const segments = (course.teacherSegments || [])
        .filter(segment => (segment.weeks || []).includes(state.activeWeek))
        .map(segment => segment.teacher)
        .filter(Boolean);
    return [...new Set(segments)].join('、') || course.teacher || '';
}

function renderWeekNav() {
    const total = totalWeeks();
    if (state.activeWeek < 1 || state.activeWeek > total) state.activeWeek = 1;
    const single = state.viewMode === 'week';
    const real = currentSemesterWeek();
    state.currentRealWeek = real;

    $('#week-mode-all').classList.toggle('is-active', !single);
    $('#week-mode-single').classList.toggle('is-active', single);
    $('#week-mode-all').setAttribute('aria-selected', String(!single));
    $('#week-mode-single').setAttribute('aria-selected', String(single));

    const stepper = $('#week-stepper');
    stepper.hidden = !single;
    if (single) {
        const select = $('#week-select');
        const previous = Number(select.value) || state.activeWeek;
        select.innerHTML = Array.from({ length: total }, (_, index) => (
            `<option value="${index + 1}">第 ${index + 1} 周</option>`
        )).join('');
        const current = previous >= 1 && previous <= total ? previous : state.activeWeek;
        select.value = String(current);
        $('#week-prev').disabled = state.activeWeek <= 1;
        $('#week-next').disabled = state.activeWeek >= total;
    }

    $('#week-badge').hidden = !(single && real && real.week === state.activeWeek);

    const visible = visibleCourses();
    const summary = $('#schedule-summary');
    if (!single) {
        summary.textContent = '全部周次合并预览；点击卡片可修改。';
    } else if (visible.length) {
        const subjects = new Set(visible.map(course => course.name)).size;
        summary.textContent = `第 ${state.activeWeek} 周 · ${subjects} 门课 · ${visible.length} 节`;
    } else {
        summary.textContent = `第 ${state.activeWeek} 周 · 本周没有课程`;
    }
}

function setViewMode(mode) {
    state.viewMode = mode === 'week' ? 'week' : 'all';
    renderWeekNav();
    renderScheduleGrid();
    renderAgenda();
    renderCourseList();
}

function setActiveWeek(week) {
    const total = totalWeeks();
    state.activeWeek = Math.max(1, Math.min(total, Number(week) || 1));
    renderWeekNav();
    renderScheduleGrid();
    renderAgenda();
    renderCourseList();
}

function initializeWeekView() {
    const real = currentSemesterWeek();
    if (real) {
        state.viewMode = 'week';
        state.activeWeek = real.week;
    } else {
        state.viewMode = 'all';
        state.activeWeek = 1;
    }
}

function renderDayTabs() {
    $('#day-tabs').innerHTML = DAYS.map((day, index) => `
        <button class="day-tab ${state.activeDay === index + 1 ? 'is-active' : ''}" type="button" role="tab" aria-selected="${state.activeDay === index + 1}" data-day="${index + 1}">${day.replace('周', '')}</button>
    `).join('');
}

function renderScheduleGrid() {
    const courses = visibleCourses();
    const scheduleGrid = $('#schedule-grid');
    scheduleGrid.style.setProperty('--period-count', String(state.periods.length));
    const real = currentSemesterWeek();
    const isRealWeek = state.viewMode === 'week' && real && real.week === state.activeWeek;
    const parts = ['<div class="grid-corner" style="grid-column:1;grid-row:1"></div>'];
    DAYS.forEach((day, index) => {
        const today = isRealWeek && real.day === index + 1 ? ' is-today' : '';
        parts.push(`<div class="day-header${today}" style="grid-column:${index + 2};grid-row:1">${day}</div>`);
    });
    state.periods.forEach(period => {
        parts.push(`<div class="time-label" style="grid-column:1;grid-row:${period.n + 1}"><strong>${period.n}</strong><small>${period.start}</small></div>`);
        DAYS.forEach((_, dayIndex) => {
            const today = isRealWeek && real.day === dayIndex + 1 ? ' is-today' : '';
            parts.push(`<div class="grid-cell${today}" style="grid-column:${dayIndex + 2};grid-row:${period.n + 1}"></div>`);
        });
    });

    const grouped = new Map();
    courses.forEach(course => {
        const key = `${course.day}-${course.startPeriod}-${course.endPeriod}`;
        const list = grouped.get(key) || [];
        list.push(course);
        grouped.set(key, list);
    });

    grouped.forEach(group => {
        group.sort((left, right) => (left.weeks[0] ?? 0) - (right.weeks[0] ?? 0) || left.name.localeCompare(right.name, 'zh-CN'));
        const course = group[0];
        const span = Math.max(1, course.endPeriod - course.startPeriod + 1);
        const cards = group.map(item => {
            const weekTeacher = teachersForWeek(item);
            const smallLine = weekTeacher
                ? `${periodLabel(item)} · ${escapeHtml(weekTeacher)} · 本周`
                : `${periodLabel(item)} · ${escapeHtml(formatWeeks(item.weeks))}`;
            return `
            <button class="course-card" type="button" data-course-id="${item.id}" style="--course-color:${colorForCourse(item)}" aria-label="${escapeHtml(`${item.name}，${periodLabel(item)}，${weekTeacher || formatWeeks(item.weeks)}`)}">
                <span class="course-card-inner">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>${escapeHtml(item.room || '教室待核对')}</span>
                    <small>${escapeHtml(smallLine)}</small>
                </span>
            </button>
        `;
        }).join('');
        parts.push(`<div class="course-stack" data-count="${group.length}" style="--course-count:${group.length};grid-column:${course.day + 1};grid-row:${course.startPeriod + 1}/span ${span}">${cards}</div>`);
    });
    scheduleGrid.innerHTML = parts.join('');
}

function renderAgenda() {
    const courses = visibleCourses()
        .filter(course => course.day === state.activeDay)
        .sort((left, right) => left.startPeriod - right.startPeriod || left.name.localeCompare(right.name, 'zh-CN'));
    if (!courses.length) {
        $('#agenda-list').innerHTML = '<div class="agenda-empty">这一天没有课程</div>';
        return;
    }
    $('#agenda-list').innerHTML = courses.map(course => {
        const start = state.periods[course.startPeriod - 1];
        const end = state.periods[course.endPeriod - 1] || start;
        return `
            <div class="agenda-item">
                <div class="agenda-time"><strong>${start.start}</strong><small>${end.end}</small></div>
                <button class="agenda-course" type="button" data-course-id="${course.id}" style="--course-color:${colorForCourse(course)}">
                    <strong>${escapeHtml(course.name)}</strong>
                    <span>${escapeHtml(course.room || '教室待核对')}${course.teacher ? ` · ${escapeHtml(course.teacher)}` : ''}</span>
                    <small>${escapeHtml(formatWeeks(course.weeks))} · 第 ${course.startPeriod}-${course.endPeriod} 节</small>
                </button>
            </div>
        `;
    }).join('');
}

function renderCourseList() {
    const sorted = [...state.courses].sort((left, right) => (
        left.day - right.day || left.startPeriod - right.startPeriod || left.weeks[0] - right.weeks[0]
    ));
    $('#course-list').innerHTML = sorted.map(course => `
        <button class="course-row" type="button" data-course-id="${course.id}" style="--course-color:${colorForCourse(course)}">
            <span class="course-row-mark"></span>
            <span class="course-row-main">
                <strong>${escapeHtml(course.name)}</strong>
                <span>${DAYS[course.day - 1]} · 第 ${course.startPeriod}-${course.endPeriod} 节 · ${escapeHtml(course.room || '教室待核对')}${course.teacher ? ` · ${escapeHtml(course.teacher)}` : ''}</span>
            </span>
            <span class="course-row-weeks">${escapeHtml(formatWeeks(course.weeks))}</span>
        </button>
    `).join('');
}

function renderAll() {
    const review = $('#review-section');
    review.hidden = state.courses.length === 0;
    if (!state.courses.length) return;
    const analysis = analyzeSchedule(state.courses, totalWeeks());
    renderStats(analysis);
    renderQuality(analysis);
    renderWeekNav();
    renderDayTabs();
    renderScheduleGrid();
    renderAgenda();
    renderCourseList();
}

function renderWeekPicker() {
    $('#week-picker').innerHTML = Array.from({ length: totalWeeks() }, (_, index) => {
        const week = index + 1;
        return `<button type="button" class="${state.selectedWeeks.has(week) ? 'is-selected' : ''}" data-week="${week}" aria-pressed="${state.selectedWeeks.has(week)}">${week}</button>`;
    }).join('');
}

function weekInputValue(weeks) {
    return formatWeeks(weeks).replace(/周$/, '').replaceAll('、', ',');
}

function openCourseDialog(course = null, defaults = {}) {
    state.editingId = course?.id ?? null;
    $('#dialog-title').textContent = course ? '编辑课程' : '添加课程';
    $('#course-name').value = course?.name || '';
    $('#course-room').value = course?.room || '';
    $('#course-teacher').value = course?.teacher || '';
    $('#course-day').value = String(course?.day || defaults.day || state.activeDay || 1);
    $('#course-start-period').value = String(course?.startPeriod || defaults.period || 1);
    $('#course-end-period').value = String(course?.endPeriod || defaults.period || 2);
    state.selectedWeeks = new Set(course?.weeks || Array.from({ length: totalWeeks() }, (_, index) => index + 1));
    $('#course-weeks-input').value = weekInputValue([...state.selectedWeeks]);
    $('#delete-course').hidden = !course;
    renderWeekPicker();
    $('#course-dialog').showModal();
    window.setTimeout(() => $('#course-name').focus(), 80);
}

function closeCourseDialog() {
    $('#course-dialog').close();
    state.editingId = null;
}

function syncWeeksFromInput() {
    const parsed = parseWeekString($('#course-weeks-input').value, totalWeeks(), { allowBare: true });
    state.selectedWeeks = new Set(parsed);
    renderWeekPicker();
}

function saveCourse(event) {
    event.preventDefault();
    const wasEditing = state.editingId !== null;
    const name = normalizeText($('#course-name').value);
    if (!name) {
        $('#course-name').focus();
        showToast('请填写课程名称');
        return;
    }
    syncWeeksFromInput();
    const weeks = [...state.selectedWeeks].sort((a, b) => a - b);
    if (!weeks.length) {
        $('#course-weeks-input').focus();
        showToast('请至少选择一个上课周次');
        return;
    }
    const startPeriod = Number($('#course-start-period').value);
    const endPeriod = Math.max(startPeriod, Number($('#course-end-period').value));
    const teacher = normalizeText($('#course-teacher').value);
    const existingCourse = state.courses.find(course => course.id === state.editingId);
    const keepsTeacherSegments = existingCourse
        && existingCourse.teacher === teacher
        && existingCourse.weeks.length === weeks.length
        && existingCourse.weeks.every((week, index) => week === weeks[index]);
    const data = {
        name,
        room: normalizeText($('#course-room').value),
        teacher,
        teacherSegments: keepsTeacherSegments
            ? existingCourse.teacherSegments
            : teacher ? [{ teacher, weeks }] : [],
        day: Number($('#course-day').value),
        startPeriod,
        endPeriod,
        weeks,
    };

    if (state.editingId !== null) {
        const index = state.courses.findIndex(course => course.id === state.editingId);
        if (index >= 0) state.courses[index] = { ...state.courses[index], ...data };
    } else {
        state.courses.push({ ...data, id: state.nextId++ });
    }
    state.courses = consolidateCourseRecords(state.courses).map(course => ({
        ...course,
        id: course.id ?? state.nextId++,
    }));
    closeCourseDialog();
    renderAll();
    setFlowStep(3);
    showToast(wasEditing ? '课程已更新' : '课程已添加');
}

function deleteEditingCourse() {
    if (state.editingId === null) return;
    state.courses = state.courses.filter(course => course.id !== state.editingId);
    closeCourseDialog();
    renderAll();
    showToast('课程已删除');
}

function editCourseById(id) {
    const course = state.courses.find(item => item.id === Number(id));
    if (course) openCourseDialog(course);
}

function exportCalendar() {
    const analysis = analyzeSchedule(state.courses, totalWeeks());
    if (!analysis.canExport) {
        $('#issue-list').hidden = false;
        renderQuality(analysis);
        showToast('请先处理关键识别问题');
        return;
    }

    try {
        const result = generateIcs({
            courses: state.courses,
            periods: state.periods,
            anchorDate: $('#start-date').value,
            anchorWeek: 1,
            semesterName: $('#semester-name').value,
        });
        const blob = new Blob([result.content], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const baseName = normalizeText($('#semester-name').value || '西工大课表').replace(/[\\/:*?"<>|]/g, '-');
        anchor.href = url;
        anchor.download = `${baseName}.ics`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setFlowStep(4);
        showToast(`已生成 ${result.eventCount} 个日历事件`);
    } catch (error) {
        showToast(error.message || 'ICS 生成失败');
    }
}

function bindUpload() {
    const dropZone = $('#drop-zone');
    const input = $('#file-input');
    input.addEventListener('change', () => handleFile(input.files?.[0]));
    ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.remove('is-dragging');
    }));
    dropZone.addEventListener('drop', event => handleFile(event.dataTransfer?.files?.[0]));
    $('#reparse-button').addEventListener('click', parseCurrentFile);
    $('#demo-button').addEventListener('click', loadDemo);
    $('#manual-add-start').addEventListener('click', () => openCourseDialog());
}

function bindSettings() {
    $('#semester-preset').addEventListener('change', event => {
        if (event.target.value !== 'custom') applySemesterPreset(event.target.value);
    });
    $('#total-weeks').addEventListener('change', () => {
        $('#total-weeks').value = String(totalWeeks());
        state.courses = state.courses.map(course => ({
            ...course,
            weeks: course.weeks.filter(week => week <= totalWeeks()),
            teacherSegments: (course.teacherSegments || []).map(segment => ({
                ...segment,
                weeks: (segment.weeks || []).filter(week => week <= totalWeeks()),
            })).filter(segment => segment.weeks.length),
        }));
        renderAll();
        if (state.fileBuffer) showToast('教学周数已更新，可点击“重新识别”应用到原文件');
    });
    $('#period-list').addEventListener('change', event => {
        const input = event.target.closest('input[data-period]');
        if (!input) return;
        const period = state.periods.find(item => item.n === Number(input.dataset.period));
        if (period && input.value) period[input.dataset.kind] = input.value;
        renderEditorOptions();
        renderScheduleGrid();
        renderAgenda();
    });
    $('#reset-periods').addEventListener('click', () => {
        state.periods = NPU_PERIODS.map(period => ({ ...period }));
        renderPeriodSettings();
        renderEditorOptions();
        renderAll();
        showToast('已恢复长安校区默认作息');
    });
}

function bindReview() {
    $('#week-mode-all').addEventListener('click', () => setViewMode('all'));
    $('#week-mode-single').addEventListener('click', () => setViewMode('week'));
    $('#week-prev').addEventListener('click', () => setActiveWeek(state.activeWeek - 1));
    $('#week-next').addEventListener('click', () => setActiveWeek(state.activeWeek + 1));
    $('#week-select').addEventListener('change', event => setActiveWeek(Number(event.target.value)));
    $('#day-tabs').addEventListener('click', event => {
        const button = event.target.closest('[data-day]');
        if (!button) return;
        state.activeDay = Number(button.dataset.day);
        renderDayTabs();
        renderAgenda();
    });
    ['#schedule-grid', '#agenda-list', '#course-list'].forEach(selector => {
        $(selector).addEventListener('click', event => {
            const button = event.target.closest('[data-course-id]');
            if (button) editCourseById(button.dataset.courseId);
        });
    });
    $('#issue-list').addEventListener('click', event => {
        const button = event.target.closest('[data-issue-index]');
        if (!button) return;
        const course = state.courses[Number(button.dataset.issueIndex)];
        if (course) openCourseDialog(course);
    });
    $('#toggle-issues').addEventListener('click', () => {
        $('#issue-list').hidden = !$('#issue-list').hidden;
        renderQuality(analyzeSchedule(state.courses, totalWeeks()));
    });
    $('#add-course').addEventListener('click', () => openCourseDialog());
    $('#export-button').addEventListener('click', exportCalendar);
    $('#clear-courses').addEventListener('click', event => {
        const button = event.currentTarget;
        if (button.dataset.confirm !== 'true') {
            button.dataset.confirm = 'true';
            button.textContent = '再次点击清空';
            window.clearTimeout(state.clearTimer);
            state.clearTimer = window.setTimeout(() => {
                button.dataset.confirm = 'false';
                button.textContent = '清空结果';
            }, 2600);
            return;
        }
        state.courses = [];
        button.dataset.confirm = 'false';
        button.textContent = '清空结果';
        $('#review-section').hidden = true;
        setFlowStep(state.fileBuffer ? 2 : 1);
        showToast('识别结果已清空，原文件未受影响');
    });
}

function bindDialog() {
    $('#course-form').addEventListener('submit', saveCourse);
    $('#dialog-close').addEventListener('click', closeCourseDialog);
    $('#cancel-course').addEventListener('click', closeCourseDialog);
    $('#delete-course').addEventListener('click', deleteEditingCourse);
    $('#course-dialog').addEventListener('click', event => {
        if (event.target === $('#course-dialog')) closeCourseDialog();
    });
    $('#course-start-period').addEventListener('change', () => {
        const start = Number($('#course-start-period').value);
        if (Number($('#course-end-period').value) < start) $('#course-end-period').value = String(start);
    });
    $('#course-weeks-input').addEventListener('change', syncWeeksFromInput);
    $('#week-picker').addEventListener('click', event => {
        const button = event.target.closest('[data-week]');
        if (!button) return;
        const week = Number(button.dataset.week);
        if (state.selectedWeeks.has(week)) state.selectedWeeks.delete(week);
        else state.selectedWeeks.add(week);
        $('#course-weeks-input').value = weekInputValue([...state.selectedWeeks]);
        renderWeekPicker();
    });
    $$('.week-shortcuts [data-week-action]').forEach(button => button.addEventListener('click', () => {
        const action = button.dataset.weekAction;
        const weeks = Array.from({ length: totalWeeks() }, (_, index) => index + 1);
        if (action === 'all') state.selectedWeeks = new Set(weeks);
        if (action === 'odd') state.selectedWeeks = new Set(weeks.filter(week => week % 2 === 1));
        if (action === 'even') state.selectedWeeks = new Set(weeks.filter(week => week % 2 === 0));
        if (action === 'clear') state.selectedWeeks = new Set();
        $('#course-weeks-input').value = state.selectedWeeks.size ? weekInputValue([...state.selectedWeeks]) : '';
        renderWeekPicker();
    }));
}

function init() {
    initTheme();
    renderPeriodSettings();
    renderEditorOptions();
    renderWeekNav();
    renderDayTabs();
    bindUpload();
    bindSettings();
    bindReview();
    bindDialog();
}

init();
