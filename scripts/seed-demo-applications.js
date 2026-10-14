const mongoose = require('mongoose');
const JobApplication = require('../src/models/JobApplication');
const connectDatabase = require('../src/config/database');

const demoApplications = [
  {
    companyName: 'Demo · Northstar Analytics',
    jobTitle: 'Junior Data Analyst',
    salary: '₹4,00,000–₹5,00,000 per year',
    location: 'Pune, Maharashtra',
    applicationDate: new Date('2026-05-12T00:00:00.000Z'),
    status: 'Applied',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
  {
    companyName: 'Demo · Cedar Labs',
    jobTitle: 'Frontend Developer',
    salary: '₹5,00,000–₹7,00,000 per year',
    location: 'Remote, India',
    applicationDate: new Date('2026-06-18T00:00:00.000Z'),
    status: 'Interview',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
  {
    companyName: 'Demo · Riverstone Robotics',
    jobTitle: 'Backend Developer',
    salary: '₹7,00,000–₹9,00,000 per year',
    location: 'Chennai, Tamil Nadu',
    applicationDate: new Date('2026-06-24T00:00:00.000Z'),
    status: 'Interview',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
  {
    companyName: 'Demo · Orbit Systems',
    jobTitle: 'Software Engineer Intern',
    salary: '₹8,000 per month',
    location: 'Mumbai, Maharashtra',
    applicationDate: new Date('2026-07-09T00:00:00.000Z'),
    status: 'Rejected',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
  {
    companyName: 'Demo · Meadow Digital',
    jobTitle: 'Full Stack Developer',
    salary: '₹6,00,000–₹8,00,000 per year',
    location: 'Bengaluru, Karnataka',
    applicationDate: new Date('2026-08-21T00:00:00.000Z'),
    status: 'Offer',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
  {
    companyName: 'Demo · Sunbeam Fintech',
    jobTitle: 'QA Engineer',
    salary: '₹6,00,000–₹8,00,000 per year',
    location: 'Remote, India',
    applicationDate: new Date('2026-08-07T00:00:00.000Z'),
    status: 'Applied',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
  {
    companyName: 'Demo · Brightpath Software',
    jobTitle: 'React Developer',
    salary: '₹5,50,000 per year',
    location: 'Hyderabad, Telangana',
    applicationDate: new Date('2026-09-15T00:00:00.000Z'),
    status: 'Interview',
    notes: 'Sample record for the dashboard charts. Not a real job application.',
  },
];

async function seedDemoApplications() {
  await connectDatabase();

  const demoNames = demoApplications.map(({ companyName }) => companyName);
  const existing = await JobApplication.find({ companyName: { $in: demoNames } }).select('companyName').lean();
  const existingNames = new Set(existing.map(({ companyName }) => companyName));
  const missingApplications = demoApplications.filter(({ companyName }) => !existingNames.has(companyName));

  if (missingApplications.length) {
    const timestampedRecords = missingApplications.map((application) => ({
      ...application,
      createdAt: application.applicationDate,
      updatedAt: application.applicationDate,
    }));
    await JobApplication.insertMany(timestampedRecords, { timestamps: false });
  }

  console.log(`Demo data ready: added ${missingApplications.length} of ${demoApplications.length} sample applications.`);
  console.log('To remove the samples, delete applications whose company names start with "Demo ·".');
}

seedDemoApplications()
  .catch((error) => {
    console.error(`Could not seed demo applications: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
