import { getAssignments } from '../features/entity/assignment/getAssignment';
import { fetchAssignment } from '../features/api/fetch';
import { Assignment } from '../features/entity/assignment/types';
import { Course } from '../features/course/types';
jest.mock('../features/api/fetch', () => ({ fetchAssignment: jest.fn() }));
const course = new Course('a', '授業A', '/portal/site/a');
beforeEach(() => { (fetchAssignment as jest.Mock).mockReset(); });
test('total API failure rejects instead of pretending zero assignments were fetched', async () => {
    (fetchAssignment as jest.Mock).mockRejectedValue(new Error('HTTP 403'));
    const report = jest.fn();
    await expect(getAssignments('tact', [course], false, report)).rejects.toThrow('取得に失敗');
    expect(report.mock.calls[0][0][0]).toContain('授業A');
});
test('partial failure keeps successful courses and reports the missing course', async () => {
    (fetchAssignment as jest.Mock).mockResolvedValueOnce(new Assignment(course, [], false)).mockRejectedValueOnce(new Error('HTTP 500'));
    const report = jest.fn();
    expect(await getAssignments('tact', [course, new Course('b', '授業B', '/portal/site/b')], false, report)).toHaveLength(1);
    expect(report.mock.calls[0][0][0]).toContain('授業B');
});
