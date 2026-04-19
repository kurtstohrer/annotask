FROM golang:1.21-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN go build -o /out/go-api .

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/go-api /app/go-api
ENV PORT=4330
EXPOSE 4330
CMD ["/app/go-api"]
