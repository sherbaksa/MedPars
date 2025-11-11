from flask import Flask
from dotenv import load_dotenv
import os
from .config import BaseConfig

def create_app():
    load_dotenv()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(base_dir, ".."))

    app = Flask(
        __name__,
        template_folder=os.path.join(base_dir, "templates"),
        instance_path=os.path.join(project_root, "instance"),
        instance_relative_config=True
    )
    app.config.from_object(BaseConfig)

    uploads_dir = os.path.join(app.instance_path, app.config["INSTANCE_UPLOADS_SUBDIR"])
    os.makedirs(uploads_dir, exist_ok=True)

    from .routes.ui import ui_bp
    from .routes.api import api_bp
    app.register_blueprint(ui_bp)
    app.register_blueprint(api_bp)

    return app