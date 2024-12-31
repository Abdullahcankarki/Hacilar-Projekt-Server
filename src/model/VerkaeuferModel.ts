import { Schema, model} from "mongoose";

export interface IVerkaeufer{
    name: string
    password: string
    admin?: boolean
}

const verkaeuferSchema = new Schema<IVerkaeufer>({
    name: {type: String, required: true, unique: true},
    password: {type: String, required: true},
    admin: {type: Boolean, default: false},
})

export const Verkaeufer = model<IVerkaeufer>("Verkaeufer", verkaeuferSchema);