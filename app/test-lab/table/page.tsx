import {notFound} from 'next/navigation';
import {testToolsEnabled} from '../../../lib/app-environment.mjs';
import {LabFrame} from '../lab-frame';
export default function LabTable(){if(!testToolsEnabled(process.env.NEXT_PUBLIC_APP_ENV,process.env.NODE_ENV))notFound();return <LabFrame/>;}
