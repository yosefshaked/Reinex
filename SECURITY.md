Security Policy
  At ThePCRunners, we take the security of our Reinex project seriously. 
  Although this codebase is open source, it powers a production service that is carefully protected. 
  We appreciate the community's efforts in identifying potential security issues and ask 
  that you follow our responsible disclosure guidelines outlined below.

Reporting a Vulnerability
  If you discover a potential security vulnerability, please report it to us privately and responsibly. 
  You can reach our security team at shaked@thepcrunners.com. In your report, please include details about the issue, 
  steps to reproduce it, and any relevant information. We ask that you do not publicly disclose the vulnerability 
  until we have addressed it.

  When reporting, please follow these guidelines:
      •	Act in Good Faith: Investigate and report without causing disruption. Do not exploit the vulnerability beyond 
      what is necessary to demonstrate it.
    •	Keep it Private: Share the details only with us. Avoid posting on public forums, issue trackers, or social 
      media until a fix is in place.
    •	Be Patient and Collaborative: We will review your report as quickly as possible and may reach out for further 
      information or to coordinate a fix. While we do not promise specific response or resolution timelines, we will 
      prioritize security issues and keep you updated on progress.
  We greatly appreciate your disclosure and will gladly acknowledge your contribution once the issue is resolved 
  (if you wish to be credited). No legal action will be taken against those who discover and report vulnerabilities 
  responsibly in line with this policy.

Project Security Practices
  We design and maintain Reinex with a strong security posture, implementing multiple layers of protection:
    •	Row Level Security (RLS): Our project uses Supabase with RLS enabled on database tables. This means the database 
      itself enforces strict access control, ensuring users can only read or modify data they are authorized to access. 
      RLS provides an extra defense-in-depth, guarding data even if an application bug arises.
    •	Server-Side Enforcement: All sensitive operations and business logic occur on the server side (e.g., within our 
      secured API endpoints). The frontend never directly performs privileged actions. Every API request requires valid 
      authentication (e.g. a bearer token) and is subject to permission checks (such as organization membership and role 
      verification) on the server. This ensures that even with the code visible, unauthorized actions cannot be completed 
      from the client alone.
    •	Principle of Least Privilege: We follow the principle of least privilege throughout the system. 
      Each service, API route, and database role is granted only the minimum permissions necessary. 
      For example, user-level API calls are restricted to that user's data, and our service keys and database roles are 
      configured to prevent broad access. This limits the impact of any single vulnerability.
    •	Secret Management: No sensitive secrets or credentials (API keys, database passwords, etc.) are present in this repository. 
      All secrets are stored securely in environment variables or our deployment platform’s secret manager and are never exposed 
      in the codebase. This reduces the risk of leaked credentials and ensures that contributors cannot accidentally access production secrets.
    •	Ongoing Security Practices: We regularly apply security updates and monitor dependencies for vulnerabilities. 
      Code changes are reviewed, and tests are in place for critical functionality. By keeping libraries up-to-date and 
      reviewing code for security implications, we aim to catch issues early and maintain a robust security standard.
Notes for Contributors
  Contributors to Reinex are key to keeping the project secure. If you are contributing code or documentation, 
  please keep the following best practices in mind:
    •	Never Commit Secrets: Ensure that API keys, passwords, or any confidential tokens are not hard-coded or committed to the repository. 
      Use environment variables or configuration files (added to .gitignore) for any secret values. Double-check that you don’t accidentally 
      include secrets in debug output, comments, or commit history.
    •	Maintain RLS and Access Controls: If your contribution involves database changes (such as new tables or views), enable Row Level 
      Security on those tables and create appropriate policies so that data access remains restricted by user role or ownership. Similarly, 
      when adding or modifying API endpoints, continue to enforce authentication and authorization. Leverage existing patterns (like requiring 
      a user token and using membership/role check helpers) to ensure new routes do not bypass security checks.
    •	Follow the Principle of Least Privilege: When integrating new services or performing operations, grant only the necessary permissions. 
      For example, if you introduce a new Supabase function or external API integration, use limited-access keys or roles. Avoid running any 
      code with elevated privileges unless absolutely required, and document any such need clearly in the code or PR.
    •	Validate and Sanitize Inputs: Continue to validate user input on the server side and in the database. Use parameterized queries or 
      ORM methods to prevent SQL injection, and carefully handle any data that will be used in critical operations. Never trust client-side 
      validation alone. If you use any user-provided data in security-sensitive contexts (like constructing queries or file paths), ensure it’s 
      sanitized and checked.
    •	Be Cautious with Dependencies: Introducing new dependencies can bring in security risks. Prefer well-maintained libraries and check for 
      known vulnerabilities (e.g., via npm audit or similar tools if applicable). Keep dependencies up-to-date in your contributions, and avoid 
      libraries that require overly broad permissions or seem untrustworthy.
    •	Discuss Security Implications: If your change could impact security (for example, changing authentication logic, modifying access control 
      flows, or handling of sensitive data), please mention it in the pull request or issue. Engage maintainers in discussing the approach to 
      ensure it aligns with the project’s security model. We welcome this dialogue and would rather address security considerations early in the 
      development process.
    •	Test Your Changes: Where possible, write tests for new features, especially for any security-related functionality. For instance, if adding 
      a new API route, consider adding tests for permission scenarios (authorized vs unauthorized access). This helps catch any permission oversights 
      before they make it into production.
By following these guidelines, you help protect our users and ensure that Reinex remains a secure and trusted application. Thank you to 
all contributors and researchers for your efforts in keeping our project safe. Together, we uphold a strong security posture while continuing to improve the platform.
