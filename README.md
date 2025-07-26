# Cozy Home Away LLC Static Website

Welcome to the source code for the Cozy Home Away LLC static website. This site is designed to showcase our family-friendly vacation rental and provide guests with a seamless booking experience.

## Features
- Modern, responsive design
- Highlights our featured vacation home
- Easy booking and contact options
- Hosted on AWS S3 and CloudFront for fast, secure delivery

## Project Structure
```
assets/
  css/         # Stylesheets
  js/          # JavaScript files
  images/      # Site images and logo
  sass/        # SASS source files
index.html     # Main website file
config/        # CloudFormation and deployment configs
.github/       # GitHub Actions workflows
```

## Deployment
Production deployments are managed via AWS CloudFormation and GitHub Actions. See `.github/workflows/deploy-prod.yml` and `config/prod-stack.yaml` for details.

## Getting Started
1. Clone this repository.
2. Make changes to `index.html` or assets as needed.
3. Push to the `main` branch to trigger deployment (requires AWS credentials in repo secrets).

## Architecture Diagram

```mermaid
flowchart TD
    User[User/Guest] -->|HTTPS| CloudFront[CloudFront CDN]
    CloudFront -->|Origin Access Identity| S3Bucket[S3 Website Bucket]
    CloudFront --> ACM[ACM Certificate]
    S3Bucket -->|Static Website| index.html
    CloudFront -->|Custom Domain| DNS[Route53 DNS]
    CloudFront -->|IAM Policy| IAM[Bucket Policy]
    S3Bucket -->|Encryption| KMS[AES256]
```

## Contact
For questions or booking inquiries, visit our website or email Brent Foster at brent@cozyhomeaway.com.

---
© Cozy Home Away LLC. All rights reserved.
