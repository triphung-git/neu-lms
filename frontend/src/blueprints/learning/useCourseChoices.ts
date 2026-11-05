import {uiText} from "../../shared/i18n/translate";
import {useEffect,useState} from 'react';
import {coursesService,type Course} from '../../api/coursesService';
export function useCourseChoices(role:'student'|'teacher'){
 const [courses,setCourses]=useState<Course[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError('');
 async function load(){try{const all:Course[]=[];let page=1;while(true){const result=await coursesService.list({role,page,page_size:100});all.push(...result.items);if(!result.pagination.has_next)break;page++;}if(active)setCourses(all);}catch(e){if(active)setError(e instanceof Error?e.message:uiText("Không thể tải môn học."));}finally{if(active)setLoading(false);}}void load();return()=>{active=false;};},[role]);return {courses,error,loading};}
