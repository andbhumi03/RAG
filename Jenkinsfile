pipeline {
    agent any

    environment {
        AWS_REGION = 'us-east-1'
        ECR_REGISTRY = '018789813450.dkr.ecr.us-east-1.amazonaws.com'
        IMAGE_NAME = 'rag-backend'
        AWS_CREDENTIALS_ID = 'aws-credentials' // Jenkins credential ID for AWS
        SONAR_SERVER = 'sonarqube-server'     // Jenkins tool name for SonarQube
    }

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }

        stage('Code Quality - SonarQube') {
            steps {
                script {
                    def scannerHome = tool name: "${SONAR_SERVER}", type: 'sonar'
                    withSonarQubeEnv('SonarQubeServer') {
                        sh "${scannerHome}/bin/sonar-scanner \
                        -Dsonar.projectKey=rag-assistant-backend \
                        -Dsonar.sources=rag-backend \
                        -Dsonar.exclusions=**/node_modules/**,**/dist/**"
                    }
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                dir('rag-backend') {
                    script {
                        // Use git archive stream to safely bypass any OneDrive/host file locks
                        sh 'git archive HEAD | docker build -t ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER} -'
                        sh 'docker tag ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER} ${ECR_REGISTRY}/${IMAGE_NAME}:latest'
                    }
                }
            }
        }

        stage('Container Security Scan - Trivy') {
            steps {
                script {
                    // Trivy scans the built Docker image for vulnerabilities
                    sh "trivy image --severity HIGH,CRITICAL ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER}"
                }
            }
        }

        stage('Push to AWS ECR') {
            steps {
                script {
                    awsEcrLogin(awsRegion: "${AWS_REGION}", credentialsId: "${AWS_CREDENTIALS_ID}")
                    sh "docker push ${ECR_REGISTRY}/${IMAGE_NAME}:${BUILD_NUMBER}"
                    sh "docker push ${ECR_REGISTRY}/${IMAGE_NAME}:latest"
                }
            }
        }

        stage('Deploy to AWS ECS Fargate') {
            steps {
                awsEcrLogin(awsRegion: "${AWS_REGION}", credentialsId: "${AWS_CREDENTIALS_ID}")
                // Forces ECS to pull the latest image and perform a rolling update
                sh "aws ecs update-service --cluster rag-cluster --service rag-backend-service --force-new-deployment --region ${AWS_REGION}"
            }
        }
    }

    post {
        success {
            echo 'Pipeline completed successfully! RAG Assistant deployed to AWS ECS.'
        }
        failure {
            echo 'Pipeline failed. Check logs for details on SonarQube, Trivy, or AWS deployment.'
        }
    }
}