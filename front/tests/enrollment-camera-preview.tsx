import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CameraCapture} from '../src/features/enrollments/CameraCapture';
import '../src/styles.css';
import '../src/features/enrollments/enrollments.css';
import '../src/components/ui/enrollment-ui.css';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
function Preview(){
  const [file,setFile]=useState('');
  const params=new URLSearchParams(location.search);
  return <><CameraCapture selfie={params.get('selfie')!=='false'} onClose={()=>{}} onCapture={file=>setFile(URL.createObjectURL(file))}/>{file&&<img data-testid="capture" src={file} alt="Captura ficticia"/>}</>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
