export const TRAINING_SCOPE='Role-based learning and recorded competence judgements for your organisation. Reading acknowledgement, knowledge-check scores and independently reviewed competence are separate records. These records do not certify regulated training, electronic signatures or a validated pharmaceutical quality system.';
export const TRAINING_LIMITS={curricula:50,requirements:10,enrolments:100,attempts:30,questions:10,criteria:8,files:10,page:20} as const;
export type TrainingQuestion={key:string;question:string;choices:string[];correctIndex:number};
export type TrainingAnswer={key:string;choice:number};
export function trainingQuestionsForLearner(questions:TrainingQuestion[]){return questions.map(({correctIndex,...question})=>question);}
export function markTrainingQuiz(questions:TrainingQuestion[],answers:TrainingAnswer[],passPercent:number){
 if(!questions.length){if(answers.length)throw new Error('This requirement has no knowledge-check questions');return {score:null,passed:null};}
 if(answers.length!==questions.length||new Set(answers.map(answer=>answer.key)).size!==answers.length)throw new Error('Answer every knowledge-check question once');
 const choices=new Map(answers.map(answer=>[answer.key,answer.choice]));let correct=0;
 for(const question of questions){const choice=choices.get(question.key);if(choice===undefined||!Number.isInteger(choice)||choice<0||choice>=question.choices.length)throw new Error('Choose one valid answer for every knowledge-check question');if(choice===question.correctIndex)correct++;}
 const score=Math.round(correct*100/questions.length);return {score,passed:score>=passPercent};
}
export function trainingCsvCell(value:unknown){const text=String(value??''),safe=/^[=+\-@\t\r]/.test(text)?"'"+text:text;return '"'+safe.replaceAll('"','""')+'"';}
