# Landing Page Screenshots Guide

## Overview
The landing page now includes a "Screenshots Section" that showcases the actual system interface to visitors. Currently, it displays placeholder illustrations, but you can easily replace them with real screenshots.

## How to Add Real Screenshots

### 1. Capture Screenshots
Take high-quality screenshots of these key screens:
- **Dashboard**: The main dashboard view with statistics and overview
- **Student Management**: The student roster page showing the table and filters
- **Session Recording**: The "New Session" modal dialog with the form

### 2. Prepare Images
- **Format**: PNG or JPG (PNG recommended for better quality)
- **Aspect Ratio**: 16:9 (video aspect ratio) works best
- **Resolution**: At least 1920x1080 pixels for crisp display
- **File Size**: Optimize to keep under 500KB per image for fast loading
  - Use tools like TinyPNG (https://tinypng.com) or Squoosh (https://squoosh.app)
- **Naming**: Use clear names like:
  - `dashboard-preview.png`
  - `student-management-preview.png`
  - `session-recording-preview.png`

### 3. Add to Project
Place the optimized images in: `public/screenshots/`

Create the directory if it doesn't exist:
```bash
mkdir public\screenshots
```

### 4. Update the Code
Edit `src/pages/LandingPage.jsx` and replace the placeholder divs with actual images:

**Find this section (Dashboard):**
```jsx
<div className="aspect-video flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
  <div className="text-center">
    <BarChart3 className="mx-auto h-16 w-16 text-primary/40" />
    <p className="mt-4 text-sm text-neutral-500">תמונת מסך: לוח הבקרה הראשי</p>
  </div>
</div>
```

**Replace with:**
```jsx
<img 
  src="/screenshots/dashboard-preview.png" 
  alt="לוח הבקרה הראשי של TutTiud" 
  className="aspect-video w-full object-cover"
/>
```

**Repeat for the other two sections** (Student Management and Session Recording).

### 5. Optional: Add Image Zoom on Click
For a better user experience, you can add lightbox functionality to allow users to click and see larger versions of the screenshots. Consider using a library like:
- `yet-another-react-lightbox`
- `react-image-lightbox`

## Privacy Considerations
When taking screenshots:
- **Blur or remove any real student names, personal information, or sensitive data**
- Use fake/demo data in the screenshots
- Consider creating a dedicated demo account with sample data specifically for screenshots
- Review each screenshot carefully before publishing

## Current Placeholder Structure
The landing page includes three preview sections:
1. **Dashboard Preview** - Shows the main dashboard interface
2. **Student Management Preview** - Demonstrates the student roster and filtering
3. **Session Recording Preview** - Displays the session documentation form

Each section includes:
- A title and description
- Key feature bullet points
- A screenshot placeholder (currently showing an icon)

## Beta Notice
A "Beta Notice" section is included below the screenshots to inform visitors that:
- The system is in early testing phases
- Real organizations are already using it
- Screenshots are placeholders until replaced with actual interface images
- The real interface is available upon login

## Testing
After adding screenshots:
1. Run `npm run dev` to test locally
2. Check that images load correctly
3. Verify responsive behavior on mobile and desktop
4. Test in different browsers
5. Ensure images don't slow down page load time

## Next Steps
Once you have real screenshots:
1. Replace the three placeholder sections with actual images
2. Remove or update the beta notice to reflect that real screenshots are shown
3. Consider adding more screenshots if needed (e.g., Reports, Settings)
4. Add alt text descriptions for accessibility
