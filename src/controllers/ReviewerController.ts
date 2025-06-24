import { Request, Response, NextFunction } from 'express'
import { PrismaClient, Profile } from '@prisma/client'
import nodemailer from 'nodemailer'

const prisma = new PrismaClient()

// configure your transporter once
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export default class ReviewerController {
  // POST /api/reviewer/login
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, password } = req.body
      const reviewer = await prisma.reviewer.findUnique({ where: { name } })
      if (!reviewer || reviewer.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }
      // in prod, sign a JWT here
      return res.json({ id: reviewer.id, name: reviewer.name, profiles: reviewer.profiles })
    } catch (err: any) {
      next(err)
    }
  }

  // GET /api/reviewer/next
  async getNextCV(req: Request, res: Response, next: NextFunction) {
    try {
      const reviewerId = Number(req.headers['x-reviewer-id'])
      const reviewer = await prisma.reviewer.findUnique({ where: { id: reviewerId } })
      if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' })

      // find a Reviewee matching one of the reviewer's profiles, not yet assigned
      const reviewee = await prisma.reviewee.findFirst({
        where: {
          assignedToId: null,
          profile: { in: reviewer.profiles as Profile[] },
        },
        orderBy: { submittedAt: 'asc' },
      })

      if (!reviewee) return res.status(204).send() // no content

      // tentatively assign so others won't pick it
      await prisma.reviewee.update({
        where: { id: reviewee.id },
        data: { assignedToId: reviewer.id },
      })

      return res.json(reviewee)
    } catch (err: any) {
      next(err)
    }
  }

  // POST /api/reviewer/review
  async submitReview(req: Request, res: Response, next: NextFunction) {
    try {
      const reviewerId = Number(req.headers['x-reviewer-id'])
      const { revieweeId, comments } = req.body
      if (!Array.isArray(comments)) {
        return res.status(400).json({ error: 'Comments must be an array of strings' })
      }

      // create Review
      const review = await prisma.review.create({
        data: {
          revieweeId,
          reviewerId,
          comments,
        },
      })

      // mark reviewed
      await prisma.reviewee.update({
        where: { id: revieweeId },
        data: { status: true },
      })

      // bump reviewer count
      await prisma.reviewer.update({
        where: { id: reviewerId },
        data: { reviewedCount: { increment: 1 } },
      })

      // notify reviewee
      const re = await prisma.reviewee.findUnique({
        where: { id: revieweeId },
        select: { email: true, name: true },
      })
      if (re?.email) {
        await transporter.sendMail({
          to: re.email,
          from: process.env.SMTP_FROM!,
          subject: 'Your CV has been reviewed',
          text: `Hi ${re.name},\n\nYour CV has been reviewed. Feedback:\n\n${comments.join('\n')}`,
        })
      }

      return res.status(201).json(review)
    } catch (err: any) {
      next(err)
    }
  }
}
