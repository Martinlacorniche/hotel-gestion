// Fond "aquarelle" piloté par le thème de l'utilisateur.
// Les couleurs (--bg-base, --bg-blob-*) sont posées sur :root par
// applyTheme() (cf. AuthContext / src/lib/themes.ts).
//
// À placer en première position dans le conteneur racine d'un écran,
// et NE PAS mettre de fond opaque (bg-slate-50, etc.) par-dessus, sinon
// le thème de l'user est masqué.
export function ThemedBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 h-full w-full print:hidden"
      style={{ background: 'var(--bg-base, #f8fafc)' }}
      aria-hidden="true"
    >
      <div
        className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full blur-[120px]"
        style={{ background: 'var(--bg-blob-1, rgba(199, 210, 254, 0.40))' }}
      />
      <div
        className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full blur-[120px]"
        style={{ background: 'var(--bg-blob-2, rgba(186, 230, 253, 0.40))' }}
      />
      <div
        className="absolute top-[40%] left-[40%] h-[400px] w-[400px] rounded-full blur-[100px]"
        style={{ background: 'var(--bg-blob-3, rgba(243, 232, 255, 0.50))' }}
      />
    </div>
  );
}
