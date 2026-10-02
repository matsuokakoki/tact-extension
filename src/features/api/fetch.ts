import { Assignment } from "../entity/assignment/types";
import { Quiz } from "../entity/quiz/types";
import { Course } from "../course/types";
import { decodeAssignmentFromAPI } from "../entity/assignment/decode";
import { decodeQuizFromAPI } from "../entity/quiz/decode";

/* Sakai のURLを取得する */
export const getBaseURL = (): string => {
    let baseURL = "";
    const match = location.href.match("(https?://[^/]+)/portal");
    if (match) {
        baseURL = match[1];
    }
    return baseURL;
};

/* Discover visible course links on every call; include the currently open site. */
export const fetchCourse = (): Array<Course> => {
    const courses = new Map<string, Course>();
    const add = (href: string, name: string) => {
        let url: URL;
        try { url = new URL(href, location.href); } catch { return; }
        if (url.origin !== location.origin) return;
        const match = url.pathname.match(/^\/portal\/site(?:-[a-z]+)?\/([^/]+)/);
        if (!match) return;
        let id: string;
        try { id = decodeURIComponent(match[1]); } catch { return; }
        if (id.startsWith('~') || courses.has(id)) return;
        courses.set(id, { id, name: name.trim() || id, link: url.origin + '/portal/site/' + encodeURIComponent(id) });
    };
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('.fav-sites-entry a[href], a[href*="/portal/site/"] , a[href*="/portal/site-"]'))) {
        add(link.href, link.title || link.textContent || '');
    }
    add(location.href, document.title);
    return Array.from(courses.values());
};

/* Sakai APIから課題を取得する */
export const fetchAssignment = (course: Course, useCache: boolean = false): Promise<Assignment> => {
    const queryURL = getBaseURL() + "/direct/assignment/site/" + course.id + ".json";
    return new Promise((resolve, reject) => {
        const cacheOption = useCache ? "default" : "no-cache";
        fetch(queryURL, { cache: cacheOption as RequestCache })
            .then(async (response) => {
                if (response.ok) {
                    const data = await response.json();
                    const assignmentEntries = decodeAssignmentFromAPI(data);
                    resolve(new Assignment(course, assignmentEntries, false));
                } else {
                    reject(`Request failed: ${response.status}`);
                }
            })
            .catch(reject); // Error: Request failed: 404
    });
};

/* Sakai APIからクイズを取得する */
export const fetchQuiz = (course: Course, useCache: boolean = false): Promise<Quiz> => {
    const queryURL = getBaseURL() + "/direct/sam_pub/context/" + course.id + ".json";
    return new Promise((resolve, reject) => {
        const cacheOption = useCache ? "default" : "no-cache";
        fetch(queryURL, { cache: cacheOption as RequestCache })
            .then(async (response) => {
                if (response.ok) {
                    const data = await response.json();
                    const quizEntries = decodeQuizFromAPI(data);
                    resolve(new Quiz(course, quizEntries, true));
                } else {
                    reject(`Request failed: ${response.status}`);
                }
            })
            .catch(reject); // Error: Request failed: 404
    });
};
