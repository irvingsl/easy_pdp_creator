FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
ENV U2NET_HOME=/app/models MODEL=birefnet-general-lite
# baixa o modelo na construção, para o servidor responder logo ao acordar
RUN python -c "from rembg import new_session; new_session('birefnet-general-lite')"
COPY app.py .
RUN chown -R user:user /app
USER user
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
