import os

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

class BaseConfig:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
    # Путь для загрузок внутри instance/
    INSTANCE_UPLOADS_SUBDIR = "uploads"
    MAX_CONTENT_LENGTH = 20 * 1024 * 1024  # 20 MB
    ALLOWED_EXTENSIONS = {"xlsx", "xls"}

    @staticmethod
    def init_app(app):  # хук на будущее
        pass
