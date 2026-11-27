import React from "react";
const RX = /(\/\/.*$)|("[^"]*"|'[^']*'|`[^`]*`)|\b(const|let|await|async|return|if|throw|new|import|from|export|function)\b|(\b[A-Za-z_]\w*)(?=\()/g;
const CLS = ["", "text-slate-500 italic", "text-cyan-300", "text-indigo-300", "text-sky-300"];
export default function Highlight({ line }: { line: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of Array.from(line.matchAll(RX))) {
    const i = m.index!;
    if (i > last) out.push(line.slice(last, i));
    const g = m.findIndex((v, n) => n > 0 && v !== undefined);
    out.push(<span key={i} className={CLS[g]}>{m[0]}</span>);
    last = i + m[0].length;
  }
  out.push(line.slice(last));
  return <>{out}</>;
}
