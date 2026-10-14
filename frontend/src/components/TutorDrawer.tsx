import React from 'react';
import { QuizQuestion } from '../types';
import { Question } from '../assessment/types';
import { answerText } from '../assessment/grading';
import { tutorAPI } from '../services/api';
import { TutorChat } from './TutorChat';
import { XCircle, CheckCircle, Lightbulb } from 'lucide-react';

interface TutorDrawerProps {
  documentId: string;
  question: QuizQuestion | Question;
  /** Multiple choice: the chosen option index */
  chosenIndex?: number;
  /** Any other question type: the student's answer as text */
  studentAnswer?: string;
  onClose: () => void;
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** "Explain my mistake": the AI tutor explains a wrong answer and answers follow-up questions. */
export const TutorDrawer: React.FC<TutorDrawerProps> = ({ documentId, question, chosenIndex = -1, studentAnswer, onClose }) => {
  const q = question as Question;
  const type = q.type || 'mcq';
  const isChoice = (type === 'mcq' || type === 'true_false') && (q.options?.length || 0) >= 2;
  const correctIndex = q.correct_answer_index ?? -1;
  const correctText = isChoice ? `${letter(correctIndex)}. ${q.options![correctIndex]}` : answerText({ ...q, type } as Question);
  const yourText = isChoice ? (chosenIndex >= 0 ? `${letter(chosenIndex)}. ${q.options![chosenIndex]}` : '') : (studentAnswer || '');

  return (
    <TutorChat
      title="Explain my mistake"
      subtitle="Your AI tutor, grounded in your document"
      icon={<Lightbulb className="w-5 h-5" />}
      placeholder="Ask a follow-up or answer the tutor's question..."
      onClose={onClose}
      request={(history, followUp, options) => tutorAPI.explainMistake({
        document_id: documentId,
        question: q.question,
        options: isChoice ? q.options! : [],
        correct_answer_index: isChoice ? correctIndex : -1,
        chosen_index: isChoice ? chosenIndex : -1,
        question_type: type,
        correct_answer_text: isChoice ? undefined : correctText,
        student_answer_text: isChoice ? undefined : (studentAnswer || '(no answer)'),
        explanation: q.explanation || '',
        history,
        message: followUp,
      }, options)}
      context={
        <div className="bg-white rounded-2xl border border-slate-100 p-5 text-sm">
          <p className="font-semibold text-slate-800 mb-3">{q.question}</p>
          <div className="space-y-1.5">
            {yourText && (
              <p className="flex items-start gap-2 text-rose-700">
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span><span className="font-bold">Your answer:</span> {yourText}</span>
              </p>
            )}
            <p className="flex items-start gap-2 text-emerald-700">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span><span className="font-bold">Correct:</span> {correctText}</span>
            </p>
          </div>
        </div>
      }
    />
  );
};
