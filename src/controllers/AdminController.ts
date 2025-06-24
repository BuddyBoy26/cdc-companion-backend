import { Request, Response, NextFunction } from 'express'
import { PrismaClient, Profile } from '@prisma/client'

const prisma = new PrismaClient()

export default class AdminController {
  // POST /api/admin/login
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, password } = req.body
      const admin = await prisma.reviewer.findUnique({ where: { name, admin: true } })
      if (!admin || admin.password !== password) {
        return res.status(401).json({ error: 'Invalid admin credentials' })
      }
      // sign JWT in prod
      return res.json({ id: admin.id, name: admin.name })
    } catch (err: any) {
      next(err)
    }
  }

  // GET /api/admin/reviewees
  async listReviewees(req: Request, res: Response, next: NextFunction) {
    try {
      const all = await prisma.reviewee.findMany({ include: { assignedTo: true, review: true } })
      return res.json(all)
    } catch (err: any) {
      next(err)
    }
  }

  // GET /api/admin/reviewers
  async listReviewers(req: Request, res: Response, next: NextFunction) {
    try {
      const all = await prisma.reviewer.findMany({ include: { assignedCVs: true, reviewsGiven: true } })
      return res.json(all)
    } catch (err: any) {
      next(err)
    }
  }

  // GET /api/admin/reviews
  async listReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const all = await prisma.review.findMany({ include: { reviewee: true, reviewer: true } })
      return res.json(all)
    } catch (err: any) {
      next(err)
    }
  }

  // POST /api/admin/allocate
  async allocate(req: Request, res: Response, next: NextFunction) {
    try {
      // 1) fetch all CVs that haven’t been assigned yet
      const pending = await prisma.reviewee.findMany({
        where: { assignedToId: null },
      })
      if (pending.length === 0) {
        return res.json({ message: 'No CVs to allocate' })
      }

      // 2) fetch all reviewers (we’ll enforce their quota in JS)
      const reviewers = await prisma.reviewer.findMany()

      // 3) for each unassigned CV…
      for (const cv of pending) {
        // a) filter down to those who handle this profile AND still have capacity
        const eligible = reviewers
          .filter(r =>
            r.profiles.includes(cv.profile) &&
            r.reviewedCount < r.reviewsNumber
          )
          .sort((a, b) => a.reviewedCount - b.reviewedCount)

        // b) if nobody is eligible, skip
        if (eligible.length === 0) {
          continue
        }

        // c) pick the least-busy reviewer
        const chosen = eligible[0]

        // d) assign the CV in the database
        await prisma.reviewee.update({
          where: { id: cv.id },
          data: { assignedToId: chosen.id },
        })

        // e) increment their reviewedCount in the database…
        await prisma.reviewer.update({
          where: { id: chosen.id },
          data: { reviewedCount: { increment: 1 } },
        })

        // …and in our in-memory copy so subsequent loops see the updated load
        chosen.reviewedCount++
      }

      return res.json({ message: 'Allocation complete' })
    } catch (err) {
      next(err)
    }
  }

}