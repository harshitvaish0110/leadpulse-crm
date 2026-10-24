FROM python:3.11-slim

WORKDIR /app

# Install CPU-only PyTorch first to avoid downloading multi-gigabyte CUDA libraries
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001

CMD ["python", "app.py"]
