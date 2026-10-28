import {notFound} from 'next/navigation';
import {testToolsEnabled} from '../../lib/app-environment.mjs';
import {TestLab} from './test-lab';
export default function TestLabPage(){if(!testToolsEnabled(process.env.NEXT_PUBLIC_APP_ENV,process.env.NODE_ENV))notFound();return <TestLab/>;}
