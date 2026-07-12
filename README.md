<!-- Visual Banner -->
<h1 align="center">LameSim</h1>
<p align="center">
  <b>2D Finite Element Method (FEM) Simulator for Blade Mechanics</b><br>
  <a href="https://mozartestladibufala.github.io/lamesim/">Live Frontend Demo</a>
</p>

---

## Project Overview

LameSim is an interactive computational mechanics tool designed to model the stress distribution and physical deformation of a metal blade subjected to external forces. 

**Objective:** To transition from a basic kinematic geometric editor to a rigorous Client-Server architecture utilizing the Finite Element Method (FEM). This allows for accurate computation of mechanical stress matrices, material elasticity, and eventually, failure and fracture mechanics.

---

## Features

- **Vectorial Geometry Interface:** Interactive drawing and manipulation of a blade's topological contour using the Canvas API.
- **Automated Meshing:** Dynamic generation of triangular meshes (nodes and elements) adapted for numerical analysis.
- **Client-Server Architecture:** Separation of the frontend geometric modeling and the backend mathematical solver.
- **Stress Visualization:** Real-time generation of heatmaps mapping stress concentrations within the metal mesh.
- **Physical Accuracy:** Input management using standard mechanical units (Newtons for applied force vectors).

---

## Data Architecture

The system serializes the geometric mesh and boundary conditions from the JavaScript frontend and transmits them to the Python backend for matrix computation.

### API Payload Example (JSON)
```json
{
  "points": [
    {"x": 300, "y": 200},
    {"x": 400, "y": 250}
  ],
  "triangles": [
    [0, 1, 2]
  ],
  "arrows": [
    {"startX": 350, "startY": 250, "endX": 400, "endY": 250, "force": 1000}
  ],
  "material": {
    "young_modulus": 200000,
    "poisson_ratio": 0.3
  }
}