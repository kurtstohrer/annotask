FROM rust:1.82-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release --bin stress-rust-api

FROM alpine:3.20
WORKDIR /app
COPY --from=build /src/target/release/stress-rust-api /app/stress-rust-api
ENV PORT=4360
EXPOSE 4360
CMD ["/app/stress-rust-api"]
