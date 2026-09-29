pipeline {
    agent any
    
    environment {
        AWS_REGION = 'us-east-1'
        ECR_REGISTRY = '018789813450.dkr.ecr.us-east-1.amazonaws.com'
        IMAGE_NAME = 'rag-backend'
        DOCKERHUB_CREDENTIALS = credentials('dockerhub-credentials')
        SONARQUBE_SERVER = 'SonarQube-Server'
    }

    options {
        skipDefaultCheckout(true)
    }

    stages {
        stage('Checkout Code') {
            steps {
                deleteDir()
                sh 'git config --global --add safe.directory "*"'
                git branch: 'main', credentialsId: 'git-credentials', url: 'https://github.com/andbhumi03/RAG.git'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    scannerHome = tool 'SonarQubeScanner'
                    withSonarQubeEnv(SONARQUBE_SERVER) {
                        sh "${scannerHome}/bin/sonar-scanner \
                        -Dsonar.projectKey=rag-backend \
                        -Dsonar.sources=."
                    }
                }
            }
        }

        stage('Build & Push to ECR') {
            steps {
                dir('rag-backend') {
                    withCredentials([aws(credentialsId: 'aws-credentials', accessKeyVariable: 'AWS_ACCESS_KEY_ID', secretKeyVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                        script {
                            echo 'Building Docker image for ECR...'
                            sh "docker build -t ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER} ."
                            sh "docker tag ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER} ${ECR_REGISTRY}/${IMAGE_NAME}:latest"

                            echo 'Logging into AWS ECR...'
                            sh "aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}"

                            echo 'Pushing image to ECR safely...'
                            retry(3) {
                                sh "docker push --disable-content-trust ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER}"
                            }
                            retry(3) {
                                sh "docker push --disable-content-trust ${ECR_REGISTRY}/${IMAGE_NAME}:latest"
                            }
                        }
                    }
                }
            }
        }

        stage('Push to Docker Hub') {
            steps {
                dir('rag-backend') {
                    script {
                        echo 'Pushing image to Docker Hub...'
                        docker.withRegistry('https://index.docker.io/v1/', 'DOCKERHUB_CREDENTIALS') {
                            def customImage = docker.image("bhuumika07/rag-backend:${BUILD_NUMBER}")
                            customImage.build(".")
                            customImage.push()
                            
                            def latestImage = docker.image("bhuumika07/rag-backend:latest")
                            latestImage.push()
                        }
                    }
                }
            }
        }

        stage('Deploy to AWS ECS Fargate') {
            steps {
                withCredentials([aws(credentialsId: 'aws-credentials', accessKeyVariable: 'AWS_ACCESS_KEY_ID', secretKeyVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                    script {
                        echo 'Updating AWS ECS Service...'
                        sh "aws ecs update-service --cluster rag-cluster --service rag-backend-service --force-new-deployment --region ${AWS_REGION}"
                    }
                }
            }
        }
    }

    post {
        success {
            echo 'Pipeline completed successfully! RAG Assistant deployed to AWS ECS Fargate.'
        }
        failure {
            echo 'Pipeline failed. Check the console logs for details.'
        }
    }
}