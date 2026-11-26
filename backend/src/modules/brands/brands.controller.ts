/** HTTP layer for brands: read the validated request, call the service, set the status code. */
import type { FastifyReply, FastifyRequest } from "fastify"
import { AppError, badRequest } from "../../common/errors.js"
import { ASSET_KINDS, type AddDetailsInput, type AllowInput, type CreateBrandInput, type SearchBrandsQuery, type UpdateBrandInput } from "./brands.dto.js"
import { MAX_ASSET_BYTES, type BrandsService } from "./brands.service.js"

type Id = { Params: { id: string } }

export class BrandsController {
  constructor(private readonly service: BrandsService) {}

  list = async () => this.service.list()

  search = async (request: FastifyRequest<{ Querystring: SearchBrandsQuery }>) => this.service.search(request.query)

  addDetails = async (request: FastifyRequest<Id & { Body: AddDetailsInput }>) => this.service.addDetails(request.params.id, request.body)

  get = async (request: FastifyRequest<Id>) => this.service.get(request.params.id)

  create = async (request: FastifyRequest<{ Body: CreateBrandInput }>, reply: FastifyReply) =>
    reply.status(201).send(await this.service.create(request.body))

  update = async (request: FastifyRequest<Id & { Body: UpdateBrandInput }>) => this.service.update(request.params.id, request.body)

  delete = async (request: FastifyRequest<Id>, reply: FastifyReply) => {
    await this.service.delete(request.params.id)
    return reply.status(204).send()
  }

  /** multipart/form-data: `kind` (logo | favicon | app_icon, default logo) and `file` */
  uploadAsset = async (request: FastifyRequest<Id>, reply: FastifyReply) => {
    if (!request.isMultipart()) throw badRequest("Send the image as multipart/form-data with a 'file' field")
    let kind = "logo"
    let file: { filename: string; mimetype: string; data: Buffer } | undefined
    try {
      for await (const part of request.parts({ limits: { fileSize: MAX_ASSET_BYTES, files: 1 } })) {
        if (part.type === "field" && part.fieldname === "kind") kind = String(part.value)
        else if (part.type === "file" && part.fieldname === "file") {
          file = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() }
        }
      }
    } catch (err) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new AppError(413, "File is larger than 5 MB")
      throw err
    }
    if (!(ASSET_KINDS as readonly string[]).includes(kind)) throw new AppError(422, `kind must be one of: ${ASSET_KINDS.join(", ")}`)
    if (!file) throw new AppError(422, "file is required")
    const asset = await this.service.addAsset(request.params.id, kind as (typeof ASSET_KINDS)[number], file.filename, file.data, file.mimetype)
    return reply.status(201).send(asset)
  }

  deleteAsset = async (request: FastifyRequest<{ Params: { id: string; assetId: string } }>, reply: FastifyReply) => {
    await this.service.deleteAsset(request.params.id, request.params.assetId)
    return reply.status(204).send()
  }

  listAllow = async (request: FastifyRequest<Id>) => this.service.listAllow(request.params.id)

  addAllow = async (request: FastifyRequest<Id & { Body: AllowInput }>, reply: FastifyReply) =>
    reply.status(201).send(await this.service.addAllow(request.params.id, request.body))

  deleteAllow = async (request: FastifyRequest<{ Params: { id: string; allowId: string } }>, reply: FastifyReply) => {
    await this.service.deleteAllow(request.params.id, request.params.allowId)
    return reply.status(204).send()
  }
}
