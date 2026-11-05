import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LearningHub,CourseAttendance} from '../blueprints/learning/LearningHub';
import {ReportCharts} from '../blueprints/learning/ReportCharts';
import {uiText} from '../shared/i18n/translate';
const mocks=vi.hoisted(()=>({list:vi.fn(),get:vi.fn()}));
vi.mock('../api/coursesService',()=>({coursesService:{list:mocks.list}}));
vi.mock('../blueprints/learning/api',()=>({get:mocks.get,post:vi.fn(),root:'/api/v1/learning'}));
const hub={course:{id:'c1',name:'Lập trình',status:'open'},manager:false,students:[],lessons:[],completed:[],assignments:[],enrollment_open:true,has_password:true};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mocks.list.mockResolvedValue({items:[hub.course],pagination:{has_next:false}});mocks.get.mockImplementation((path:string)=>Promise.resolve(path.endsWith('/attendance')?{sessions:[],records:[],summary:[],total_sessions:0}:path.endsWith('/progress')?{items:[]}:hub));});afterEach(cleanup);
describe('Workspace regression',()=>{
 it.each(['sv','gv'])('loads %s courses from items',async(role)=>{render(<MemoryRouter initialEntries={['/'+role+'/hoc-tap']}><LearningHub/></MemoryRouter>);expect(await screen.findByRole('heading',{name:'Lập trình'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Điểm danh'})).not.toBeInTheDocument();expect(mocks.list).toHaveBeenCalledWith({role:role==='gv'?'teacher':'student',page:1,page_size:100});});
 it('loads attendance inside the selected course',async()=>{render(<MemoryRouter initialEntries={['/sv/mon-hoc/c1']}><Routes><Route path="/sv/mon-hoc/:monId" element={<CourseAttendance/>}/></Routes></MemoryRouter>);await screen.findByText('Xuất CSV');expect(mocks.get).toHaveBeenCalledWith('/courses/c1/attendance',expect.any(AbortSignal));});
 it('renders three accessible charts',()=>{render(<ReportCharts metrics={{downloads:2,new_users:5}} labels={{downloads:'Lượt tải',new_users:'Tài khoản mới'}} trend={[{day:'2026-11-05',count:2}]}/>);expect(screen.getAllByRole('img')).toHaveLength(3);expect(document.querySelector('svg rect')).toBeTruthy();expect(document.querySelector('svg polyline')).toBeTruthy();});
 it('translates UI without translating inserted course titles',()=>{localStorage.setItem('lms-language','en');expect(uiText('Bảng điểm')).toBe('Gradebook');expect(uiText('Đã chuyển môn {0} sang trạng thái lưu trữ.',['Lập trình'])).toContain('Lập trình');});
});
