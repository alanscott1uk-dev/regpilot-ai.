// One spreadsheet row per buyer question, including deliberately blank answers.
const cell=(value:string)=>{
 const line=value.replace(/[\t\r\n]+/g,' ').trim();
 return /^[=+@-]/.test(line)?"'"+line:line;
};
export function portalTable(labels:readonly string[],fields:readonly {label:string;answer:string}[]){
 const answers=new Map(fields.map(field=>[field.label,field.answer]));
 return labels.map(label=>[cell(label),cell(answers.get(label)??'')].join('\t')).join('\r\n');
}
