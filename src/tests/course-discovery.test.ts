/** @jest-environment jsdom */
import { fetchCourse } from '../features/api/fetch';
beforeEach(() => { document.body.innerHTML = ''; document.title = '授業A'; history.replaceState({}, '', '/portal'); });
test('an empty initial menu is rediscovered when course links appear later', () => {
    expect(fetchCourse()).toEqual([]);
    document.body.innerHTML = '<a href="/portal/site/course-a" title="授業A">A</a>';
    expect(fetchCourse().map(course => course.id)).toEqual(['course-a']);
});
test('current course is included even when absent from favorites', () => {
    history.replaceState({}, '', '/portal/site/course-current/tool/assignments');
    document.body.innerHTML = '<div class="fav-sites-entry"><a href="/portal/site/course-other">授業B</a></div>';
    expect(fetchCourse().map(course => course.id)).toEqual(['course-other', 'course-current']);
});
test('duplicate, personal workspace and cross-origin links are excluded', () => {
    document.body.innerHTML = '<a href="/portal/site/a">A</a><a href="/portal/site/a">A</a><a href="/portal/site/~personal">個人</a><a href="https://evil.example/portal/site/b">B</a>';
    expect(fetchCourse().map(course => course.id)).toEqual(['a']);
});
