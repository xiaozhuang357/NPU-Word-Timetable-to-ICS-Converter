import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

import {
    NPU_PERIODS,
    analyzeSchedule,
    extractCoursesFromCell,
    generateIcs,
    parseScheduleTable,
    parseWeekString,
    splitLeadingWeekPrefix,
} from '../schedule-core.js';

test('拆分黏连在课程名前的裸周次范围', () => {
    const result = splitLeadingWeekPrefix('10-17大学英语核心能力', 18);
    assert.equal(result.text, '大学英语核心能力');
    assert.deepEqual(result.weeks, [10, 11, 12, 13, 14, 15, 16, 17]);

    const courses = extractCoursesFromCell('10-17大学英语核心能力', {
        day: 1,
        startPeriod: 3,
        endPeriod: 4,
        totalWeeks: 18,
    });
    assert.equal(courses.length, 1);
    assert.equal(courses[0].name, '大学英语核心能力');
    assert.deepEqual(courses[0].weeks, [10, 11, 12, 13, 14, 15, 16, 17]);
});

test('兼容连续、离散及单双周输入', () => {
    assert.deepEqual(parseWeekString('1-8,10-12,15', 18, { allowBare: true }), [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 15]);
    assert.deepEqual(parseWeekString('(1~9(单)周)', 18), [1, 3, 5, 7, 9]);
    assert.deepEqual(parseWeekString('2-10双周', 18), [2, 4, 6, 8, 10]);
    assert.deepEqual(parseWeekString('第1、3、5周', 18), [1, 3, 5]);
});

test('同一课程换教师时合并课程并保留分周教师', () => {
    const text = [
        '软件测试 02',
        '(11~14周) (1-2节) 启真楼204-2 郑炜',
        '(15~16周) (1-2节) 启真楼204-2 高利鹏',
        '(17~18周) (1-2节) 启真楼204-2 蔡文静',
        '14院 24级软工 专业核心必修 2课堂',
    ].join('\n');
    const courses = extractCoursesFromCell(text, {
        day: 5,
        startPeriod: 1,
        endPeriod: 2,
        totalWeeks: 18,
    });
    assert.equal(courses.length, 1);
    assert.equal(courses[0].name, '软件测试');
    assert.equal(courses[0].teacher, '郑炜、高利鹏、蔡文静');
    assert.deepEqual(courses[0].weeks, [11, 12, 13, 14, 15, 16, 17, 18]);
    assert.deepEqual(courses[0].teacherSegments, [
        { teacher: '郑炜', weeks: [11, 12, 13, 14] },
        { teacher: '高利鹏', weeks: [15, 16] },
        { teacher: '蔡文静', weeks: [17, 18] },
    ]);
});

test('从含合并单元格的西工大课表中识别星期与节次', () => {
    const { document } = parseHTML(`
        <table>
            <tr>
                <th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th>
            </tr>
            <tr>
                <td>1</td>
                <td rowspan="2">大学英语核心能力 08<br>(10~17周) (1-2节) 教西B1-302 李老师<br>10-17大学英语核心能力</td>
                <td rowspan="2">软件测试 02<br>(11~14周) (1-2节) 启真楼204-2 郑炜<br>(15~16周) (1-2节) 启真楼204-2 高利鹏</td>
                <td></td><td></td><td></td><td></td><td></td>
            </tr>
            <tr><td>2</td><td></td><td></td><td></td><td></td><td></td></tr>
        </table>
    `);
    const result = parseScheduleTable(document.querySelector('table'), { totalWeeks: 18 });
    assert.equal(result.courses.length, 2);
    const english = result.courses.find(course => course.name === '大学英语核心能力');
    assert.ok(english);
    assert.equal(english.day, 1);
    assert.equal(english.startPeriod, 1);
    assert.equal(english.endPeriod, 2);
    assert.equal(english.room, '教西B1-302');
    assert.deepEqual(english.weeks, [10, 11, 12, 13, 14, 15, 16, 17]);
    const testing = result.courses.find(course => course.name === '软件测试');
    assert.ok(testing);
    assert.equal(testing.teacher, '郑炜、高利鹏');
    assert.deepEqual(testing.weeks, [11, 12, 13, 14, 15, 16]);
});

test('质量检查会发现时间冲突和周次黏连', () => {
    const analysis = analyzeSchedule([
        { name: '高等数学', room: '教西A-101', teacher: '张老师', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] },
        { name: '大学物理', room: '教西B-201', teacher: '李老师', day: 1, startPeriod: 2, endPeriod: 3, weeks: [2] },
        { name: '10-17大学英语核心能力', room: '教西C-301', teacher: '王老师', day: 3, startPeriod: 3, endPeriod: 4, weeks: [10] },
    ], 18);
    assert.equal(analysis.conflicts.length, 1);
    assert.ok(analysis.issues.some(issue => issue.level === 'error' && issue.message.includes('拼进')));
    assert.equal(analysis.canExport, false);
});

test('ICS 使用长安校区第 13 节时间并生成独立事件', () => {
    const result = generateIcs({
        courses: [{
            name: '互联网系统综合项目实践',
            room: '教西B1-203',
            teacher: '金强国、陈老师',
            teacherSegments: [
                { teacher: '金强国', weeks: [1] },
                { teacher: '陈老师', weeks: [2] },
            ],
            day: 1,
            startPeriod: 11,
            endPeriod: 13,
            weeks: [1, 2],
        }],
        periods: NPU_PERIODS,
        anchorDate: '2026-08-31',
        anchorWeek: 1,
        semesterName: '2026–2027 秋 · 西工大',
        now: new Date('2026-08-31T00:00:00Z'),
    });
    assert.equal(result.eventCount, 2);
    assert.equal((result.content.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.match(result.content, /DTSTART;TZID=Asia\/Shanghai:20260831T190000/);
    assert.match(result.content, /DTEND;TZID=Asia\/Shanghai:20260831T212500/);
    assert.match(result.content, /DTSTART;TZID=Asia\/Shanghai:20260907T190000/);
    assert.match(result.content, /LOCATION:教西B1-203/);
    assert.match(result.content, /教师：金强国/);
    assert.match(result.content, /教师：陈老师/);
    result.content.split('\r\n').forEach(line => {
        assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `ICS 行超过 75 字节：${line}`);
    });
});

test('同槽课程纵向分栏且课表尺寸由内容驱动', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const scheduleGridRule = css.match(/\.schedule-grid\s*\{([^}]+)\}/)?.[1] || '';
    const courseStackRule = css.match(/\.course-stack\s*\{([^}]+)\}/)?.[1] || '';
    assert.match(scheduleGridRule, /inline-size:\s*max-content\s*;/);
    assert.match(scheduleGridRule, /repeat\(var\(--period-count/);
    assert.doesNotMatch(scheduleGridRule, /min-(?:width|height):\s*(?:1080|802)px/);
    assert.match(courseStackRule, /display:\s*grid\s*;/);
    assert.match(courseStackRule, /grid-template-columns:\s*repeat\(var\(--course-count/);
});

test('功能界面不包含营销首屏与纯装饰区块', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /class="hero(?:\s|"|')/);
    assert.doesNotMatch(html, /class="ambient(?:\s|"|')/);
    assert.doesNotMatch(html, /confidence-strip/);
    assert.ok(html.indexOf('class="flow-nav"') < html.indexOf('class="workspace-grid"'));
});
