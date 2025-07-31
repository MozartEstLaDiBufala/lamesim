# lamesim
Create a blade and test it.
Site name : https://mozartestladibufala.github.io/lamesim/
## 🔧 Résumé de mon projet de simulation

### 🎯 Objectif

Créer une **simulation visuelle et interactive** de la diffusion d’une **force (en Newtons)** dans une **lame métallique modélisée par un graphe pondéré**, avec affichage de la propagation par des flèches bleues proportionnelles à l’intensité.

---

### 🧱 Structure de données

- **`lamePoints`** : tableau de points `{x, y}` représentant les sommets de la lame.
- **`lameLines`** : tableau d’objets `{start: i, end: j}` désignant des segments entre deux indices de `lamePoints`.
- **`metalGraph`** : graphe de diffusion, chaque nœud contient :

  ```js
  {
    neighbors: [{ i: index, weight }],
    intensity: 0  // initialement, sauf injection de force
  }
