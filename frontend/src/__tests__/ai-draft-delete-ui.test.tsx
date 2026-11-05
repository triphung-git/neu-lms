import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {TeacherAIDraftsPage} from '../blueprints/ai/pages/TeacherAIDraftsPage';
const mocks=vi.hoisted(()=>({remove:vi.fn(),notify:vi.fn()}));
vi.mock('../blueprints/learning/api',()=>({remove:mocks.remove}));
vi.mock('../app/providers/NotificationContext',()=>({useNotifications:()=>({showNotification:mocks.notify})}));
vi.mock('../api/coursesService',()=>({coursesService:{list:vi.fn().mockResolvedValue({items:[]})}}));
vi.mock('../api/materialsService',()=>({materialsService:{listMaterials:vi.fn().mockResolvedValue({items:[]})}}));
vi.mock('../api/aiAssistantService',()=>({aiSummaryDraftService:{list:vi.fn().mockResolvedValue([{id:'draft1',status:'confirmed',material_title:'Tài liệu A',course_code:'WEB',course_name:'Web',version_number:1,created_at:'2026-11-05T01:00:00Z',source_file_names:[],summary:'Summary'}])}}));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();});afterEach(cleanup);
it('confirms deletion and removes the row after success',async()=>{
 mocks.remove.mockResolvedValue(undefined);render(<MemoryRouter><TeacherAIDraftsPage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Xóa bản nháp'}));
 const dialog=await screen.findByRole('dialog');expect(within(dialog).getByText(/tóm tắt đã công bố vẫn được giữ lại/)).toBeInTheDocument();expect(mocks.remove).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Xóa bản nháp'}));
 await waitFor(()=>expect(mocks.remove).toHaveBeenCalledWith('/drafts/draft1'));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(screen.queryByText('Tài liệu A')).not.toBeInTheDocument();
});
it('keeps the draft and displays API errors when deletion fails',async()=>{
 mocks.remove.mockRejectedValue(new Error('Không thể xóa bản nháp.'));render(<MemoryRouter><TeacherAIDraftsPage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Xóa bản nháp'}));const dialog=await screen.findByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'Xóa bản nháp'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('Không thể xóa bản nháp.');expect(dialog).toBeInTheDocument();
});
