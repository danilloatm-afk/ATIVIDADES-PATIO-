// TEMPORÁRIO: só para comparar prompts de ata. Será removido após o teste.
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST" });
  const apiKey = process.env.OPENAI_API_KEY;
  const { transcricao } = req.body || {};
  if (!apiKey || !transcricao) return res.status(400).json({ error: "faltou chave ou transcricao" });
  const system =
    'Você transforma a transcrição de uma conversa em uma ata em português do Brasil. Responda em JSON válido {"assunto": "...", "ata": "..."} — ambos STRINGS simples. "assunto": título de até 8 palavras do tema principal. "ata": texto com quebras de linha (\\n) no formato: "Resumo:" (1-2 frases), linha em branco, "Pontos discutidos:" (UM item "- " para CADA assunto diferente tratado na conversa: cobertura completa, se foram 15 assuntos liste 15; cada item é UMA frase curta, de no máximo ~20 palavras, dizendo o que foi dito sobre aquele assunto, mantendo números, valores, nomes e datas exatamente como falados; NÃO acrescente explicações, contexto ou conclusões que não foram ditas), linha em branco, "Outros assuntos:" (itens "- " para temas paralelos/pontuais fora do foco principal; omita a seção inteira se não houve), linha em branco, "Combinados/ações:" (UM item "- " para cada combinado/próximo passo realmente dito, com o responsável quando citado; se nenhum, apenas "Nenhum combinado registrado" e mais nada). REGRA MAIS IMPORTANTE: use APENAS o que foi realmente dito; não infira, não complete, não invente números, decisões ou nomes — o que não ficou claro, não mencione.';
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: transcricao }],
    }),
  });
  const d = await r.json();
  try {
    res.status(200).json(JSON.parse(d.choices[0].message.content));
  } catch {
    res.status(500).json(d);
  }
};
