
export enum InterviewStatus {
  SCHEDULED = 'scheduled',
  ROUND1_COMPLETED = 'round1-completed',
  COMPLETED = 'completed',
  REJECTED = 'rejected'
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  uploadDate: string;
  status: 'shortlisted' | 'rejected';
  score: number;
  skills: string[];
  summary: string;
  position: string;
}

export interface InterviewRound {
  question: string;
  answerText: string;
  score: number;
  confidence: number;
  feedback: string;
}

export interface Interview {
  id: string;
  candidateId: string;
  candidateName: string;
  position: string;
  email: string;
  date: string;
  time: string;
  round: number;
  status: InterviewStatus;
  round1Score?: number;
  round1Answers?: InterviewRound[];
  round2Score?: number;
  round2Answers?: InterviewRound[];
  finalScore?: number;
}

export interface ResumeAnalysisResult {
  score: number;
  skills: string[];
  summary: string;
  recommendation: 'shortlist' | 'reject';
}

export interface AnswerEvaluation {
  score: number;
  confidence: number;
  transcript: string;
  feedback: string;
}
