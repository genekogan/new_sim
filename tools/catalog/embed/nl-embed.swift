// CATRUN: sentence vectors from macOS's built-in NaturalLanguage model (NLEmbedding.sentenceEmbedding, English).
// No download and no API: the model ships with the OS. Used only to measure what a pretrained sentence embedding adds
// over lexical retrieval (tools/catalog/retrieval-eval.mjs --nl); eden2 (Linux) cannot run it, see CATALOG-P0.md §3.
//   swift tools/catalog/embed/nl-embed.swift < texts.json > vectors.json      (texts.json: ["…", …])
import Foundation
import NaturalLanguage

let input = FileHandle.standardInput.readDataToEndOfFile()
let texts = try JSONSerialization.jsonObject(with: input) as! [String]
guard let emb = NLEmbedding.sentenceEmbedding(for: .english) else { FileHandle.standardError.write("no sentence embedding for English on this OS\n".data(using: .utf8)!); exit(2) }
var out: [[Double]] = []
for t in texts { out.append(emb.vector(for: t) ?? Array(repeating: 0, count: emb.dimension)) }
let data = try JSONSerialization.data(withJSONObject: ["dim": emb.dimension, "vectors": out])
FileHandle.standardOutput.write(data)
