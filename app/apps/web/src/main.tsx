import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { App } from './App';
import './styles.css';

dayjs.locale('zh-cn');
createRoot(document.getElementById('root')!).render(<App />);
