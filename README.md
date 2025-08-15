<!-- Bandeau visuel -->
<h1 align="center">⚔️ LameSim</h1>
<p align="center">
  <b>Créer et tester une lame — Simulation physique et visuelle</b><br>
  <a href="https://mozartestladibufala.github.io/lamesim/">💻 Essayer en ligne</a>
</p>

---

## 🔧 Résumé du projet

LameSim est une **simulation interactive** où l’on peut construire une lame (ou autre forme métallique) et observer **la propagation d’une force** (en Newtons) à l’intérieur du métal, **tick par tick**, avec affichage graphique.

🎯 Objectif : expérimenter la **diffusion physique** dans un matériau à partir d’un impact, en vue d’une future extension vers la **méthode des éléments finis (FEM)**.

---

## 🖱 Fonctionnalités

- 🖱 **Création interactive** de la lame et de la force sur une grille réglable
- 📐 **Modélisation par graphe pondéré**
- ⏱ **Simulation temporelle** avec slider de contrôle
- 🔍 **Visualisation dynamique** (flèches proportionnelles à l’intensité)
- 📏 **Unités réalistes** en Newtons (N)

---

## 🧱 Structure de données

### Lame
```js
lamePoints = [
  { x, y, force, angle, couleur, epaisseur }
];
lameLines = [
  { start: index, end: index }
];
```
### Force
```js
forcePoints = [
  { x, y, force, angle, couleur, epaisseur }
];
```
### Simulation
```js
simulationFramesLame   // états des points de lame par tick
simulationFramesForce  // états de la force avant diffusion
```
## 📜 Fonctions principales

- **generateSimulationFrames()** → génere tous les ticks  
- **redraw(p)** → dessine les éléments selon le ticks choisit 

---

## 🛠 Stack technique

- **HTML / CSS / JavaScript**  
- **Canvas API** pour le rendu graphique interactif  
- **GitHub Pages** pour l’hébergement  
- Modèle simplifié de **diffusion pondérée** (évolutif vers FEM)  

---

## 🚀 Roadmap

- [ ] Optimiser l’algorithme pour de grandes grilles  
- [ ] Simuler différents matériaux, et épaisseur (densité, conductivité)  
- [ ] Passage vers un solveur FEM
