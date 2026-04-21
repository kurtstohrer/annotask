# Multi-stage build: Maven resolves deps + builds fat jar, runtime image is slim JRE.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
# Resolve deps first for better layer caching
COPY pom.xml ./
RUN mvn -q -B -e dependency:go-offline
COPY src ./src
RUN mvn -q -B -e package -DskipTests
RUN cp target/stress-java-api-*.jar /out.jar

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /out.jar /app/app.jar
ENV PORT=4310
EXPOSE 4310
CMD ["java", "-jar", "/app/app.jar"]
