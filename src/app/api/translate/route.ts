import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { text, from = "fr", to = "en" } = await req.json();
  if (!text?.trim()) return NextResponse.json({ result: "" });

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: "Erreur traduction" }, { status: 500 });

  const data = await res.json();
  const result = data[0]?.map((chunk: [string]) => chunk[0]).join("") ?? "";
  return NextResponse.json({ result });
}
