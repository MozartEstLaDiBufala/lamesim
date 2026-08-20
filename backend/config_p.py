import yaml
from pathlib import Path
import logging
logger = logging.getLogger(__name__)

# Définition du chemin absolu pour éviter les erreurs de chemin relatif
CONFIG_PATH = Path(__file__).parent / "config_ya.yaml"

def load_config():
    """Charge et parse le fichier YAML en un dictionnaire Python."""
    print(f"\n[DEBUG CONFIG] Tentative de lecture de {CONFIG_PATH}...")
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as file:
            return yaml.safe_load(file)
    except FileNotFoundError:
        print(f"[Erreur] Le fichier {CONFIG_PATH} est introuvable.")
        return {}
    except yaml.YAMLError as exc:
        print(f"[Erreur] Problème de syntaxe dans le YAML : {exc}")
        return {}

# L'objet global que les autres fichiers importeront
settings = load_config()