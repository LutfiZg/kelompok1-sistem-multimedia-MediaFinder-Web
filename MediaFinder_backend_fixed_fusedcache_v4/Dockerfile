FROM golang:1.22-alpine AS build
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -o mediafinder .

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/mediafinder /usr/local/bin/mediafinder
RUN mkdir -p /app/data/uploads
ENV MF_LISTEN=":8088" MF_DB="/app/data/mediafinder.db" MF_CORS_ORIGIN="*"
EXPOSE 8088
CMD ["mediafinder"]