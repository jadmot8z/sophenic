# SOPHENIC 5.4.3 — correctif Hugging Face Image TypeScript

Correction de `electron/runtime/image-router.ts` : l'appel `InferenceClient.textToImage` force maintenant `outputType: "blob"` et transmet le `AbortSignal`. Cela sélectionne explicitement la surcharge TypeScript qui retourne un `Blob`, ce qui rend valides `blob.arrayBuffer()` et `blob.type`.

Aucune logique de routage ou de provider n'a été supprimée. Les tests internes `verify-source` et `test:sophenic` continuent de passer.
