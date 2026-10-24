# Build stage
FROM --platform=$BUILDPLATFORM golang:1.25 AS builder

WORKDIR /app
ARG TARGETOS=linux
ARG TARGETARCH

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=${TARGETARCH:-$(go env GOARCH)} go build -o music-dl ./cmd/music-dl

# Runtime stage
FROM alpine:3.22

RUN apk --no-cache add ca-certificates tzdata ffmpeg su-exec \
    && ffmpeg -version >/dev/null \
    && ffprobe -version >/dev/null

ENV TZ=Asia/Shanghai

RUN adduser -D -s /bin/sh appuser

WORKDIR /home/appuser/

COPY --from=builder /app/music-dl .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chown -R appuser:appuser /home/appuser/
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

# The entrypoint prepares the bind-mounted data directory, then runs the app
# as the unprivileged appuser.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["./music-dl", "web", "--port", "8080", "--no-browser"]
