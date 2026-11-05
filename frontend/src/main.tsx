import {currentLanguage} from './shared/i18n/translate';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './shared/styles/LearningWorkflow.css';
import App from './App'

document.documentElement.lang=currentLanguage();
if(currentLanguage()==='en')document.title='NEU LMS — Learning Management System';
window.addEventListener('lms-language',()=>window.location.reload());
window.addEventListener('storage',e=>{if(e.key==='lms-language')window.location.reload();});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
