
import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  FileText, 
  Upload, 
  Bot, 
  CheckCircle, 
  Clock, 
  Award, 
  Mail, 
  Trash2, 
  ChevronRight,
  Send,
  AlertCircle,
  Briefcase,
  LayoutDashboard,
  Volume2,
  Mic,
  Square,
  BarChart3,
  XCircle
} from 'lucide-react';
import { 
  Candidate, 
  Interview, 
  InterviewStatus, 
  InterviewRound 
} from './types';
import { 
  analyzeResume, 
  generateInterviewQuestions, 
  evaluateAudioAnswer,
  generateSpeech
} from './geminiService';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'jd' | 'resumes' | 'interviews'>('dashboard');
  const [resumes, setResumes] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [jobDescription, setJobDescription] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Interview States
  const [interviewInProgress, setInterviewInProgress] = useState<Interview | null>(null);
  const [currentQuestions, setCurrentQuestions] = useState<string[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [currentInterviewAnswers, setCurrentInterviewAnswers] = useState<InterviewRound[]>([]);
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [lastRoundResult, setLastRoundResult] = useState<{score: number, passed: boolean} | null>(null);

  // Audio States
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const savedResumes = localStorage.getItem('telawne_resumes');
    const savedInterviews = localStorage.getItem('telawne_interviews');
    const savedJD = localStorage.getItem('telawne_jd');
    if (savedResumes) setResumes(JSON.parse(savedResumes));
    if (savedInterviews) setInterviews(JSON.parse(savedInterviews));
    if (savedJD) setJobDescription(savedJD);
  }, []);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordingSeconds(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const saveToStorage = (res: Candidate[], ints: Interview[], jd: string) => {
    localStorage.setItem('telawne_resumes', JSON.stringify(res));
    localStorage.setItem('telawne_interviews', JSON.stringify(ints));
    localStorage.setItem('telawne_jd', jd);
  };

  const decodeBase64 = (base64: string) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  };

  const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> => {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
    return buffer;
  };

  const speakQuestion = async (text: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    setIsSpeaking(true);
    const base64Audio = await generateSpeech(text);
    if (base64Audio && audioContextRef.current) {
      const audioData = decodeBase64(base64Audio);
      const audioBuffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsSpeaking(false);
      source.start();
    } else setIsSpeaking(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setRecordingBlob(blob);
        // Important: Stop all tracks so the microphone icon disappears
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
    } catch (err) {
      alert("Microphone access denied. Please allow microphone access in your browser settings to continue.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!jobDescription.trim()) {
      alert('Please configure the Job Description first.');
      return;
    }
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    const updatedResumes = [...resumes];
    const updatedInterviews = [...interviews];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      await new Promise<void>((resolve) => {
        reader.onload = async (e) => {
          const dataUrl = e.target?.result as string;
          const split = dataUrl.split(',');
          const mimeType = split[0].match(/:(.*?);/)?.[1] || 'application/pdf';
          const base64 = split[1];
          const analysis = await analyzeResume(base64, mimeType, jobDescription);
          if (analysis) {
            const candidate: Candidate = {
              id: Date.now().toString() + Math.random(),
              name: file.name.split('.')[0].replace(/[_-]/g, ' '),
              email: `${file.name.split('.')[0].toLowerCase().replace(/[\s_-]/g, '.')}@example.com`,
              uploadDate: new Date().toISOString(),
              status: (analysis.recommendation === 'shortlist' && analysis.score >= 40) ? 'shortlisted' : 'rejected',
              score: analysis.score,
              skills: analysis.skills,
              summary: analysis.summary,
              position: jobDescription.split('\n')[0].substring(0, 50) || 'Technical Role'
            };
            updatedResumes.unshift(candidate);
            if (candidate.status === 'shortlisted') {
              updatedInterviews.unshift({
                id: (Date.now() + 1).toString(),
                candidateId: candidate.id, candidateName: candidate.name, email: candidate.email, position: candidate.position,
                date: new Date(Date.now() + 86400000).toISOString().split('T')[0], time: "11:00 AM", round: 1, status: InterviewStatus.SCHEDULED
              });
            }
          }
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
    setResumes(updatedResumes); setInterviews(updatedInterviews);
    saveToStorage(updatedResumes, updatedInterviews, jobDescription);
    setIsProcessing(false);
  };

  const startInterview = async (interview: Interview) => {
    setIsProcessing(true);
    const candidate = resumes.find(r => r.id === interview.candidateId);
    const questions = await generateInterviewQuestions(interview.round, interview.position, jobDescription, candidate?.summary || '');
    setCurrentQuestions(questions); setInterviewInProgress(interview);
    setCurrentQuestionIdx(0); setCurrentInterviewAnswers([]); setShowSummary(false);
    setIsProcessing(false);
    if (questions.length > 0) speakQuestion(questions[0]);
  };

  const submitAudioAnswer = async () => {
    if (!recordingBlob || !interviewInProgress) return;
    
    if (recordingBlob.size < 2000) {
      alert("Recording is too short! Please speak your answer clearly.");
      setRecordingBlob(null);
      return;
    }

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(',')[1];
      const evaluation = await evaluateAudioAnswer(currentQuestions[currentQuestionIdx], base64, 'audio/webm');
      
      const newAnswer: InterviewRound = {
        question: currentQuestions[currentQuestionIdx],
        answerText: evaluation.transcript,
        score: evaluation.score,
        confidence: evaluation.confidence,
        feedback: evaluation.feedback
      };

      const updatedAnswers = [...currentInterviewAnswers, newAnswer];
      setCurrentInterviewAnswers(updatedAnswers);
      setRecordingBlob(null);

      if (currentQuestionIdx + 1 < currentQuestions.length) {
        const nextIdx = currentQuestionIdx + 1;
        setCurrentQuestionIdx(nextIdx);
        setIsProcessing(false);
        speakQuestion(currentQuestions[nextIdx]);
      } else {
        const totalScore = updatedAnswers.reduce((sum, a) => sum + a.score, 0);
        const avgScore = totalScore / updatedAnswers.length;
        const passed = avgScore >= 5;
        
        const updatedInterviews = interviews.map(i => {
          if (i.id === interviewInProgress.id) {
            if (i.round === 1) {
              return { ...i, status: passed ? InterviewStatus.ROUND1_COMPLETED : InterviewStatus.REJECTED, round1Score: avgScore, round1Answers: updatedAnswers };
            } else {
              return { ...i, status: InterviewStatus.COMPLETED, round2Score: avgScore, round2Answers: updatedAnswers, finalScore: ((i.round1Score || 0) + avgScore) / 2 };
            }
          }
          return i;
        });

        if (interviewInProgress.round === 1 && passed) {
          updatedInterviews.unshift({
            ...interviewInProgress, id: (Date.now() + 2).toString(), round: 2, 
            date: new Date(Date.now() + 172800000).toISOString().split('T')[0], time: "02:00 PM", status: InterviewStatus.SCHEDULED, round1Score: avgScore
          });
        }

        setInterviews(updatedInterviews);
        saveToStorage(resumes, updatedInterviews, jobDescription);
        setLastRoundResult({ score: avgScore, passed });
        setShowSummary(true);
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(recordingBlob);
  };

  if (showSummary && lastRoundResult) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl p-10 text-center border border-slate-200">
          <div className={`mx-auto w-24 h-24 rounded-full flex items-center justify-center mb-6 ${lastRoundResult.passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
            {lastRoundResult.passed ? <Award size={48} /> : <XCircle size={48} />}
          </div>
          <h2 className="text-3xl font-black text-slate-900 mb-2">{lastRoundResult.passed ? 'Congratulations!' : 'Hard Luck'}</h2>
          <p className="text-slate-500 font-medium mb-8">Score for Round {interviewInProgress?.round}</p>
          
          <div className="bg-slate-50 rounded-3xl p-8 mb-8">
            <p className="text-6xl font-black text-slate-900 mb-2">{Math.round(lastRoundResult.score * 10) / 10}<span className="text-xl text-slate-400">/10</span></p>
            <p className={`font-black uppercase tracking-widest text-sm ${lastRoundResult.passed ? 'text-green-600' : 'text-red-600'}`}>
              {lastRoundResult.passed ? 'Passed - You Qualified' : 'Score below 5.0 - Application Rejected'}
            </p>
          </div>

          <button 
            onClick={() => { setInterviewInProgress(null); setShowSummary(false); setActiveTab('interviews'); }}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg transition-all"
          >
            Back to Application Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (interviewInProgress) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-200">
          <div className="bg-indigo-700 p-8 text-white relative">
            <div className="flex justify-between items-center mb-4">
              <span className="bg-indigo-500 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                Round {interviewInProgress.round}
                {isSpeaking && <Volume2 size={14} className="animate-pulse" />}
              </span>
              <span className="text-indigo-200 font-medium uppercase tracking-widest text-[10px]">
                Question {currentQuestionIdx + 1} of {currentQuestions.length}
              </span>
            </div>
            <h2 className="text-3xl font-black truncate">{interviewInProgress.candidateName}</h2>
            <p className="text-indigo-100 text-xs font-bold uppercase tracking-widest mt-1 opacity-70">{interviewInProgress.position}</p>
          </div>

          <div className="p-10">
            <div className="mb-10">
              <div className="flex gap-2 mb-6">
                {currentQuestions.map((_, idx) => (
                  <div key={idx} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${idx <= currentQuestionIdx ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                ))}
              </div>
              <div className={`bg-slate-50 border-2 p-8 rounded-3xl min-h-[140px] flex items-center relative transition-all ${isSpeaking ? 'border-indigo-400 shadow-lg shadow-indigo-50' : 'border-slate-100'}`}>
                <p className="text-2xl font-bold text-slate-800 leading-snug">
                  {currentQuestions[currentQuestionIdx]}
                </p>
                {isSpeaking && (
                   <div className="absolute top-2 right-4 flex items-center gap-1 text-indigo-600 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                     <Volume2 size={12} /> Interviewer Speaking...
                   </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-center gap-6">
              {!recordingBlob && !isProcessing && (
                <div className="flex flex-col items-center gap-4">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`w-28 h-28 rounded-full flex flex-col items-center justify-center shadow-2xl transition-all ${isRecording ? 'bg-red-500 scale-110 ring-8 ring-red-100 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'}`}
                  >
                    {isRecording ? <Square size={36} className="text-white mb-1" /> : <Mic size={36} className="text-white mb-1" />}
                    <span className="text-white text-[10px] font-black uppercase tracking-tighter">
                      {isRecording ? 'Stop Recording' : 'Start Answer'}
                    </span>
                  </button>
                  {isRecording && (
                    <div className="text-center">
                      <p className="text-red-500 font-black text-2xl mb-1">{recordingSeconds}s</p>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Speak your answer now...</p>
                    </div>
                  )}
                  {!isRecording && <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Tap to start recording your response</p>}
                </div>
              )}

              {recordingBlob && !isProcessing && (
                <div className="w-full space-y-4">
                  <div className="flex items-center justify-between bg-green-50 p-6 rounded-3xl border border-green-100 shadow-sm">
                    <div className="flex items-center gap-4">
                       <CheckCircle className="text-green-600" size={32} />
                       <div>
                         <p className="text-green-800 font-black text-lg">Response Captured</p>
                         <p className="text-green-600 text-xs font-medium">Ready for AI technical analysis</p>
                       </div>
                    </div>
                    <button onClick={() => setRecordingBlob(null)} className="p-3 hover:bg-green-100 rounded-full text-green-600 transition-colors shadow-sm">
                      <Trash2 size={24} />
                    </button>
                  </div>
                  
                  <button
                    onClick={submitAudioAnswer}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl active:scale-[0.98] transition-all text-lg"
                  >
                    Submit & Evaluate Answer
                    <ChevronRight size={20} />
                  </button>
                </div>
              )}

              {isProcessing && (
                <div className="w-full text-center py-8 space-y-6">
                  <div className="relative mx-auto w-20 h-20">
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <div>
                    <p className="text-indigo-600 font-black uppercase tracking-[0.2em] text-sm">Processing Audio Data</p>
                    <p className="text-slate-400 text-xs mt-1">Analyzing transcript, technical accuracy, and vocal confidence...</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl">
              <Briefcase className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
              TELAWNE <span className="text-indigo-600">TRANSFORMERS</span>
            </h1>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {['dashboard', 'jd', 'resumes', 'interviews'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-5 py-2 rounded-xl text-sm font-bold capitalize transition-all ${activeTab === tab ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {activeTab === 'dashboard' && (
          <div className="space-y-10">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Shortlisted', value: resumes.filter(r => r.status === 'shortlisted').length, icon: CheckCircle, color: 'green' },
                { label: 'Active Interviews', value: interviews.filter(i => i.status === InterviewStatus.SCHEDULED).length, icon: Bot, color: 'indigo' },
                { label: 'Avg Score', value: interviews.length ? Math.round(interviews.reduce((s, i) => s + (i.round1Score || 0), 0) / interviews.length * 10) / 10 : 0, icon: BarChart3, color: 'purple' },
                { label: 'Qualified Candidates', value: interviews.filter(i => (i.finalScore && i.finalScore >= 5) || (i.round1Score && i.round1Score >= 5)).length, icon: Award, color: 'orange' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-6">
                  <div className={`p-4 rounded-2xl bg-${stat.color}-50 text-${stat.color}-600`}>
                    <stat.icon size={28} />
                  </div>
                  <div>
                    <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">{stat.label}</p>
                    <p className="text-3xl font-black text-slate-900">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
              <h2 className="text-2xl font-black text-slate-900 mb-6">Recent Applicant Activity</h2>
              {resumes.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-slate-100 rounded-2xl">
                   <p className="text-slate-400 font-bold">No candidates uploaded yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {resumes.slice(0, 5).map(r => (
                    <div key={r.id} className="py-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">{r.name[0]}</div>
                        <div>
                          <p className="font-bold text-slate-900">{r.name}</p>
                          <p className="text-slate-500 text-xs">{r.position}</p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${r.status === 'shortlisted' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'jd' && (
          <div className="max-w-4xl mx-auto bg-white p-10 rounded-3xl shadow-sm border border-slate-100 space-y-8">
            <h2 className="text-3xl font-black text-slate-900">Company Job Requirements</h2>
            <p className="text-slate-500 font-medium -mt-4">Define the criteria used by the AI to screen resumes and generate interview questions.</p>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="w-full h-80 p-6 border-2 border-slate-100 rounded-3xl focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none text-lg text-slate-700 transition-all"
              placeholder="Paste the full job description, required skills, and experience details here..."
            />
            <button onClick={() => { saveToStorage(resumes, interviews, jobDescription); alert('Job Description updated successfully!'); }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-10 py-4 rounded-2xl shadow-lg shadow-indigo-100 transition-all">Update System Configuration</button>
          </div>
        )}

        {activeTab === 'resumes' && (
          <div className="space-y-8">
            <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">Upload Applicant Resumes</h2>
                <p className="text-slate-500">Multimodal AI analyzes technical skills and experience scores</p>
              </div>
              <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-4 rounded-2xl flex items-center gap-2 shadow-lg shadow-indigo-100 transition-all">
                <Upload size={20} />
                {isProcessing ? 'AI Processing...' : 'Upload PDF/Images'}
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.txt" onChange={handleFileUpload} className="hidden" disabled={isProcessing} />
              </label>
            </div>
            
            {resumes.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-3xl border border-slate-100">
                <FileText className="mx-auto text-slate-200 mb-4" size={64} />
                <p className="text-slate-400 font-bold">No candidates found. Upload resumes to start screening.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {resumes.map(r => (
                  <div key={r.id} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div className="space-y-4">
                      <div className="flex justify-between">
                        <div className={`p-2 rounded-xl ${r.status === 'shortlisted' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {r.status === 'shortlisted' ? <CheckCircle size={24} /> : <AlertCircle size={24} />}
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-slate-900">{r.score}</p>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Match Score</p>
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold truncate">{r.name}</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{r.position}</p>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-3 bg-slate-50 p-4 rounded-xl border border-slate-100 italic">"{r.summary}"</p>
                    </div>
                    <div className="mt-6 pt-4 border-t border-slate-50 flex items-center justify-between">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${r.status === 'shortlisted' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.status}</span>
                      <button onClick={() => {
                        const filtered = resumes.filter(cand => cand.id !== r.id);
                        setResumes(filtered);
                        saveToStorage(filtered, interviews, jobDescription);
                      }} className="text-slate-300 hover:text-red-500 transition-colors">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'interviews' && (
          <div className="space-y-8">
            <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">Audio Assessment Portal</h2>
                <p className="text-slate-500">Listen to live AI interviews and review candidate performance</p>
              </div>
              <Mic className="text-indigo-600 opacity-20" size={48} />
            </div>

            {interviews.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-3xl border border-slate-100">
                <p className="text-slate-400 font-bold">No interviews scheduled yet. Shortlist candidates to see them here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {interviews.map(int => (
                  <div key={int.id} className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between hover:border-indigo-200 transition-colors group">
                    <div>
                      <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-xl group-hover:bg-indigo-600 group-hover:text-white transition-all">
                            {int.candidateName.charAt(0)}
                          </div>
                          <div>
                            <h3 className="text-2xl font-black text-slate-900">{int.candidateName}</h3>
                            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">{int.position}</p>
                          </div>
                        </div>
                        <span className="px-4 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-black uppercase tracking-widest">Round {int.round}</span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4 mb-8">
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">Status</p>
                          <p className="font-bold text-slate-700 text-xs capitalize">{int.status.replace('-', ' ')}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">Score / 10</p>
                          <p className="font-bold text-indigo-600 text-xs">{int.round1Score ? Math.round(int.round1Score * 10) / 10 : '--'}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <p className="text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">Confidence</p>
                          <p className="font-bold text-green-600 text-xs">
                            {int.round1Answers?.length ? Math.round(int.round1Answers.reduce((s,a)=>s+a.confidence,0)/int.round1Answers.length * 10)/10 : '--'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {int.status === InterviewStatus.SCHEDULED ? (
                      <button 
                        onClick={() => startInterview(int)} 
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-lg shadow-indigo-50 transition-all active:scale-95"
                      >
                        <Mic size={20} /> Start Audio Interview
                      </button>
                    ) : (
                      <div className={`w-full py-4 rounded-2xl text-center font-black uppercase text-[10px] tracking-[0.2em] border-2 ${int.status === InterviewStatus.REJECTED ? 'bg-red-50 text-red-500 border-red-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                        {int.status === InterviewStatus.REJECTED ? 'Candidate Failed Assessment' : 'Interview Phase Completed'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
