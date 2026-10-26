import { Profiler, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Root } from '../../src/app/Root';
import { recordRender } from './metrics';
import '../../src/styles/global.css';

declare const __RAYNO_COMPILER_PROFILE__: boolean;
const app = <StrictMode><BrowserRouter><Root /></BrowserRouter></StrictMode>;
createRoot(document.getElementById('root')!).render(__RAYNO_COMPILER_PROFILE__
  ? <Profiler id="workspace" onRender={recordRender}>{app}</Profiler> : app);
